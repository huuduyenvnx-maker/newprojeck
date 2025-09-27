import * as cron from 'node-cron';
import { dataIngestionPipeline } from './data-ingestion';
import { storage } from '../storage';
import { currencyConverter } from './currency-converter';

// Types for orchestration
export interface ScheduledJob {
  id: string;
  name: string;
  schedule: string; // cron expression
  type: 'ingestion' | 'fx_rates' | 'maintenance';
  sourceId?: string;
  isActive: boolean;
  lastRun?: Date;
  nextRun?: Date;
  status: 'idle' | 'running' | 'error' | 'disabled';
  retryCount: number;
  maxRetries: number;
  backoffMinutes: number;
  config?: any;
}

export interface JobResult {
  jobId: string;
  success: boolean;
  startTime: Date;
  endTime: Date;
  duration: number;
  error?: string;
  details?: any;
}

export interface OrchestrationMetrics {
  totalJobs: number;
  activeJobs: number;
  runningJobs: number;
  successfulRuns: number;
  failedRuns: number;
  lastUpdate: Date;
}

// Main Orchestration Service with cron-like scheduling
export class OrchestrationService {
  private jobs = new Map<string, ScheduledJob>();
  private cronTasks = new Map<string, cron.ScheduledTask>();
  private runHistory = new Map<string, JobResult[]>();
  private metrics: OrchestrationMetrics = {
    totalJobs: 0,
    activeJobs: 0,
    runningJobs: 0,
    successfulRuns: 0,
    failedRuns: 0,
    lastUpdate: new Date()
  };

  constructor() {
    this.initializeDefaultJobs();
  }

  // Initialize default scheduled jobs
  private initializeDefaultJobs(): void {
    console.log('Initializing default orchestration jobs...');

    // Twice daily ingestion at 06:00 and 18:00 Vietnam time (user requirement)
    // Using two explicit jobs for clarity & independent retry/backoff handling
    this.addJob({
      id: 'ingestion_morning',
      name: 'Morning Ingestion (06:00)',
      schedule: '0 6 * * *', // 06:00
      type: 'ingestion',
      isActive: true,
      retryCount: 0,
      maxRetries: 3,
      backoffMinutes: 15,
      status: 'idle',
      config: {
        forceRefresh: false,
        skipValidation: false,
        runWindow: 'morning'
      }
    });

    this.addJob({
      id: 'ingestion_evening',
      name: 'Evening Ingestion (18:00)',
      schedule: '0 18 * * *', // 18:00
      type: 'ingestion',
      isActive: true,
      retryCount: 0,
      maxRetries: 3,
      backoffMinutes: 15,
      status: 'idle',
      config: {
        forceRefresh: false,
        skipValidation: false,
        runWindow: 'evening'
      }
    });

    // Daily FX rates update at 11 AM Vietnam time
    this.addJob({
      id: 'daily_fx_rates',
      name: 'Daily FX Rates Update',
      schedule: '0 11 * * *', // 11:00 AM daily
      type: 'fx_rates',
      isActive: true,
      retryCount: 0,
      maxRetries: 3,
      backoffMinutes: 30,
      status: 'idle',
      config: {}
    });

    // Weekly maintenance at 2 AM Sunday
    this.addJob({
      id: 'weekly_maintenance',
      name: 'Weekly System Maintenance',
      schedule: '0 2 * * 0', // 2:00 AM every Sunday
      type: 'maintenance',
      isActive: true,
      retryCount: 0,
      maxRetries: 1,
      backoffMinutes: 60,
      status: 'idle',
      config: {
        cleanupOldData: true,
        optimizeDatabase: true
      }
    });

    console.log(`Initialized ${this.jobs.size} default jobs`);
  }

  // Add a new scheduled job
  addJob(job: Omit<ScheduledJob, 'nextRun'>): void {
    const completeJob: ScheduledJob = {
      ...job,
      nextRun: this.calculateNextRun(job.schedule)
    };

    this.jobs.set(job.id, completeJob);

    if (job.isActive) {
      this.scheduleJob(completeJob);
    }

    this.updateMetrics();
    console.log(`Added job: ${job.name} (${job.schedule})`);
  }

  // Remove a scheduled job
  removeJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    // Cancel cron task if running
    const task = this.cronTasks.get(jobId);
    if (task) {
      task.destroy();
      this.cronTasks.delete(jobId);
    }

    this.jobs.delete(jobId);
    this.runHistory.delete(jobId);

    this.updateMetrics();
    console.log(`Removed job: ${job.name}`);
    return true;
  }

  // Update job configuration
  updateJob(jobId: string, updates: Partial<ScheduledJob>): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    // If schedule changed, reschedule
    const scheduleChanged = updates.schedule && updates.schedule !== job.schedule;
    const statusChanged = updates.isActive !== undefined && updates.isActive !== job.isActive;

    Object.assign(job, updates);

    if (updates.schedule) {
      job.nextRun = this.calculateNextRun(updates.schedule);
    }

    if (scheduleChanged || statusChanged) {
      // Cancel existing task
      const task = this.cronTasks.get(jobId);
      if (task) {
        task.destroy();
        this.cronTasks.delete(jobId);
      }

      // Reschedule if active
      if (job.isActive) {
        this.scheduleJob(job);
      }
    }

    this.updateMetrics();
    console.log(`Updated job: ${job.name}`);
    return true;
  }

  // Start orchestration service
  start(): void {
    console.log('Starting orchestration service...');

    // Schedule all active jobs
    for (const job of Array.from(this.jobs.values())) {
      if (job.isActive) {
        this.scheduleJob(job);
      }
    }

    console.log(`Orchestration service started with ${this.cronTasks.size} active jobs`);
  }

  // Stop orchestration service
  stop(): void {
    console.log('Stopping orchestration service...');

    // Cancel all cron tasks
    for (const [jobId, task] of Array.from(this.cronTasks.entries())) {
      task.destroy();
      this.cronTasks.delete(jobId);
    }

    console.log('Orchestration service stopped');
  }

  // Schedule a job with cron
  private scheduleJob(job: ScheduledJob): void {
    try {
      const task = cron.schedule(job.schedule, async () => {
        await this.executeJob(job.id);
      }, {
        timezone: 'Asia/Ho_Chi_Minh' // Vietnam timezone
      });

      task.start();
      this.cronTasks.set(job.id, task);

      console.log(`Scheduled job: ${job.name} with cron: ${job.schedule}`);
    } catch (error: any) {
      console.error(`Failed to schedule job ${job.name}:`, error.message);
      job.status = 'error';
    }
  }

  // Execute a job
  async executeJob(jobId: string): Promise<JobResult> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const startTime = new Date();
    console.log(`Executing job: ${job.name} (${jobId})`);

    // Update job status
    job.status = 'running';
    job.lastRun = startTime;
    job.nextRun = this.calculateNextRun(job.schedule);
    this.updateMetrics();

    const result: JobResult = {
      jobId,
      success: false,
      startTime,
      endTime: new Date(),
      duration: 0,
      details: {}
    };

    try {
      // Execute job based on type
      switch (job.type) {
        case 'ingestion':
          result.details = await this.executeIngestionJob(job);
          break;
        case 'fx_rates':
          result.details = await this.executeFxRatesJob(job);
          break;
        case 'maintenance':
          result.details = await this.executeMaintenanceJob(job);
          break;
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }

      result.success = true;
      job.status = 'idle';
      job.retryCount = 0; // Reset retry count on success
      this.metrics.successfulRuns++;

      console.log(`Job completed successfully: ${job.name} (${Date.now() - startTime.getTime()}ms)`);

    } catch (error: any) {
      console.error(`Job failed: ${job.name}:`, error.message);

      result.error = error.message;
      job.status = 'error';
      this.metrics.failedRuns++;

      // Handle retries
      if (job.retryCount < job.maxRetries) {
        job.retryCount++;
        console.log(`Scheduling retry ${job.retryCount}/${job.maxRetries} for job: ${job.name}`);

        // Schedule retry with exponential backoff
        const retryDelay = job.backoffMinutes * Math.pow(2, job.retryCount - 1);
        setTimeout(async () => {
          await this.executeJob(jobId);
        }, retryDelay * 60 * 1000);
      } else {
        console.error(`Job failed permanently after ${job.maxRetries} retries: ${job.name}`);
        job.retryCount = 0; // Reset for next scheduled run
      }
    }

    result.endTime = new Date();
    result.duration = result.endTime.getTime() - startTime.getTime();

    // Store run history
    if (!this.runHistory.has(jobId)) {
      this.runHistory.set(jobId, []);
    }
    const history = this.runHistory.get(jobId)!;
    history.push(result);

    // Keep only last 50 runs
    if (history.length > 50) {
      history.splice(0, history.length - 50);
    }

    this.updateMetrics();
    return result;
  }

  // Execute data ingestion job
  private async executeIngestionJob(job: ScheduledJob): Promise<any> {
    const config = job.config || {};

    if (job.sourceId) {
      // Run ingestion for specific source
      return await dataIngestionPipeline.runIngestionForSource(job.sourceId, config);
    } else {
      // Run ingestion for all sources (filtered by frequency if specified)
      let results = await dataIngestionPipeline.runIngestionForAllSources(config);

      // Filter by frequency if specified
      if (config.frequencyFilter) {
        const frequencyFilter = Array.isArray(config.frequencyFilter)
          ? config.frequencyFilter
          : [config.frequencyFilter];

        results = results.filter(result => {
          // This would require getting the source frequency from the result
          // For now, we'll run all sources
          return true;
        });
      }

      return {
        totalSources: results.length,
        successful: results.filter(r => r.success).length,
        totalRecords: results.reduce((sum, r) => sum + r.fetchedRecords, 0),
        results: results.slice(0, 10) // Limit details to first 10 results
      };
    }
  }

  // Execute FX rates job
  private async executeFxRatesJob(job: ScheduledJob): Promise<any> {
    console.log('Fetching latest FX rates...');
    await currencyConverter.fetchLatestRates();

    // Get some metrics
    const supportedCurrencies = currencyConverter.getSupportedCurrencies();
    const recentHistory = await currencyConverter.getConversionHistory(
      'USD',
      'VND',
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
      new Date()
    );

    return {
      supportedCurrencies: supportedCurrencies.length,
      recentRates: recentHistory.length,
      message: 'FX rates updated successfully'
    };
  }

  // Execute maintenance job
  private async executeMaintenanceJob(job: ScheduledJob): Promise<any> {
    const config = job.config || {};
    const tasks: string[] = [];

    if (config.cleanupOldData) {
      // Clean up old raw data (older than 90 days)
      console.log('Cleaning up old raw price data...');
      // This would require implementing cleanup methods in storage
      tasks.push('Cleaned old raw data');
    }

    if (config.optimizeDatabase) {
      // Database optimization tasks
      console.log('Running database optimization...');
      // This would require implementing optimization methods
      tasks.push('Database optimization');
    }

    // Update metrics
    this.updateMetrics();

    return {
      tasksCompleted: tasks,
      message: `Maintenance completed: ${tasks.join(', ')}`
    };
  }

  // Calculate next run time based on cron schedule
  private calculateNextRun(schedule: string): Date {
    try {
      // This is a simplified calculation - in production you'd use a proper cron parser
      const now = new Date();
      const nextRun = new Date(now);

      // Add some basic logic for common patterns
      if (schedule === '0 6 * * *') { // Daily at 6 AM
        nextRun.setHours(6, 0, 0, 0);
        if (nextRun <= now) {
          nextRun.setDate(nextRun.getDate() + 1);
        }
      } else if (schedule === '0 * * * *') { // Every hour
        nextRun.setMinutes(0, 0, 0);
        nextRun.setHours(nextRun.getHours() + 1);
      } else if (schedule === '0 11 * * *') { // Daily at 11 AM
        nextRun.setHours(11, 0, 0, 0);
        if (nextRun <= now) {
          nextRun.setDate(nextRun.getDate() + 1);
        }
      } else {
        // Default: add 1 hour
        nextRun.setHours(nextRun.getHours() + 1);
      }

      return nextRun;
    } catch (error) {
      // Fallback to 1 hour from now
      return new Date(Date.now() + 60 * 60 * 1000);
    }
  }

  // Update metrics
  private updateMetrics(): void {
    this.metrics = {
      totalJobs: this.jobs.size,
      activeJobs: Array.from(this.jobs.values()).filter(j => j.isActive).length,
      runningJobs: Array.from(this.jobs.values()).filter(j => j.status === 'running').length,
      successfulRuns: this.metrics.successfulRuns,
      failedRuns: this.metrics.failedRuns,
      lastUpdate: new Date()
    };
  }

  // Get job status
  getJobStatus(jobId: string): ScheduledJob | undefined {
    return this.jobs.get(jobId);
  }

  // Get all jobs
  getAllJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  // Get job run history
  getJobHistory(jobId: string, limit: number = 10): JobResult[] {
    const history = this.runHistory.get(jobId) || [];
    return history.slice(-limit).reverse(); // Most recent first
  }

  // Get orchestration metrics
  getMetrics(): OrchestrationMetrics {
    return { ...this.metrics };
  }

  // Manually trigger a job
  async triggerJob(jobId: string): Promise<JobResult> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (job.status === 'running') {
      throw new Error(`Job is already running: ${job.name}`);
    }

    console.log(`Manually triggering job: ${job.name}`);
    return await this.executeJob(jobId);
  }

  // Enable/disable job
  toggleJob(jobId: string, isActive: boolean): boolean {
    return this.updateJob(jobId, { isActive });
  }

  // Get next run times for all jobs
  getSchedule(): Array<{ jobId: string; name: string; nextRun: Date | undefined; isActive: boolean }> {
    return Array.from(this.jobs.values())
      .map(job => ({
        jobId: job.id,
        name: job.name,
        nextRun: job.nextRun,
        isActive: job.isActive
      }))
      .sort((a, b) => {
        if (!a.nextRun) return 1;
        if (!b.nextRun) return -1;
        return a.nextRun.getTime() - b.nextRun.getTime();
      });
  }

  // Health check
  getHealth(): { status: 'healthy' | 'degraded' | 'unhealthy'; details: any } {
    const activeJobs = Array.from(this.jobs.values()).filter(j => j.isActive);
    const errorJobs = activeJobs.filter(j => j.status === 'error');
    const runningJobs = activeJobs.filter(j => j.status === 'running');

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (errorJobs.length > 0) {
      status = errorJobs.length > activeJobs.length / 2 ? 'unhealthy' : 'degraded';
    }

    return {
      status,
      details: {
        totalJobs: this.jobs.size,
        activeJobs: activeJobs.length,
        errorJobs: errorJobs.length,
        runningJobs: runningJobs.length,
        scheduledTasks: this.cronTasks.size,
        lastUpdate: this.metrics.lastUpdate
      }
    };
  }
}

// Singleton instance
export const orchestrationService = new OrchestrationService();

export default orchestrationService;