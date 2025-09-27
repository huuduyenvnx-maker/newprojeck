/**
 * Export Progress Modal Component
 * Shows progress for Vietnamese agricultural market data exports
 */

import { useEffect, useState } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { 
  CheckCircle, 
  XCircle, 
  Loader2, 
  Download, 
  X, 
  Clock,
  FileText,
  Database
} from 'lucide-react';
import useExport from '@/hooks/use-export';

interface ExportProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobId: string | null;
}

export default function ExportProgressModal({
  isOpen,
  onClose,
  jobId
}: ExportProgressModalProps) {
  const { 
    useExportStatus, 
    cancelExport, 
    downloadExport, 
    formatFileSize, 
    getExportTypeVietnamese,
    getStatusColor,
    isCancelling
  } = useExport();
  
  const { data: job, isLoading } = useExportStatus(jobId);
  const [autoClose, setAutoClose] = useState(false);

  // Auto-close modal 3 seconds after completion
  useEffect(() => {
    if (job?.status === 'completed' && !autoClose) {
      setAutoClose(true);
      const timer = setTimeout(() => {
        onClose();
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [job?.status, onClose, autoClose]);

  const handleCancel = () => {
    if (jobId && job?.status === 'processing') {
      cancelExport.mutate(jobId);
    }
  };

  const handleDownload = () => {
    if (jobId && job?.downloadAvailable) {
      downloadExport(jobId, job.fileName);
    }
  };

  const getStatusIcon = () => {
    if (!job) return <Loader2 className="w-5 h-5 animate-spin" />;
    
    switch (job.status) {
      case 'pending':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'processing':
        return <Loader2 className="w-5 h-5 animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Loader2 className="w-5 h-5 animate-spin" />;
    }
  };

  const getProgressColor = () => {
    if (!job) return 'bg-blue-500';
    
    switch (job.status) {
      case 'completed':
        return 'bg-green-500';
      case 'failed':
        return 'bg-red-500';
      case 'processing':
        return 'bg-blue-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]" data-testid="modal-export-progress">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {getStatusIcon()}
            <span>Xuất Dữ Liệu Nông Nghiệp</span>
          </DialogTitle>
          <DialogDescription>
            {job?.typeVietnamese && (
              <span>Đang xuất {job.typeVietnamese.toLowerCase()}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Job Status */}
          {job && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={getStatusColor(job.status)}>
                  {job.statusVietnamese}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {getExportTypeVietnamese(job.type)}
                </span>
              </div>
              {job.fileName && (
                <span className="text-xs text-muted-foreground font-mono">
                  {job.fileName}
                </span>
              )}
            </div>
          )}

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Tiến độ</span>
              <span>{job?.progress || 0}%</span>
            </div>
            <Progress 
              value={job?.progress || 0} 
              className="h-2"
              data-testid="progress-export"
            />
            {job && job.status === 'processing' && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {job.processedRecords.toLocaleString('vi-VN')} / {job.totalRecords.toLocaleString('vi-VN')} bản ghi
                </span>
                {job.timeRemainingVietnamese && (
                  <span>Còn lại: {job.timeRemainingVietnamese}</span>
                )}
              </div>
            )}
          </div>

          {/* Export Details */}
          {job && (
            <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Database className="w-4 h-4" />
                  <span>Tổng bản ghi:</span>
                </div>
                <p className="text-lg font-semibold">
                  {job.totalRecords.toLocaleString('vi-VN')}
                </p>
              </div>
              
              {job.fileSize && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="w-4 h-4" />
                    <span>Kích thước:</span>
                  </div>
                  <p className="text-lg font-semibold">
                    {formatFileSize(job.fileSize)}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Time Information */}
          {job && (
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Bắt đầu: {new Date(job.startTime).toLocaleString('vi-VN')}</div>
              {job.completedTime && (
                <div>Hoàn thành: {new Date(job.completedTime).toLocaleString('vi-VN')}</div>
              )}
              {job.estimatedCompletion && job.status === 'processing' && (
                <div>Dự kiến hoàn thành: {new Date(job.estimatedCompletion).toLocaleString('vi-VN')}</div>
              )}
            </div>
          )}

          {/* Error Message */}
          {job?.status === 'failed' && job.error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">
                <span className="font-semibold">Lỗi:</span> {job.error}
              </p>
            </div>
          )}

          {/* Success Message */}
          {job?.status === 'completed' && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">
                ✅ Xuất dữ liệu thành công! Tệp đã sẵn sàng để tải xuống.
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 justify-end">
            {job?.status === 'processing' && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleCancel}
                disabled={isCancelling}
                data-testid="button-cancel-export"
              >
                {isCancelling ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Đang hủy...
                  </>
                ) : (
                  <>
                    <X className="w-4 h-4 mr-2" />
                    Hủy
                  </>
                )}
              </Button>
            )}
            
            {job?.downloadAvailable && (
              <Button 
                variant="default" 
                size="sm" 
                onClick={handleDownload}
                data-testid="button-download-export"
              >
                <Download className="w-4 h-4 mr-2" />
                Tải xuống
              </Button>
            )}
            
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onClose}
              data-testid="button-close-modal"
            >
              Đóng
            </Button>
          </div>

          {/* Auto-close notification */}
          {job?.status === 'completed' && autoClose && (
            <div className="text-center text-xs text-muted-foreground">
              Tự động đóng sau 3 giây...
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}