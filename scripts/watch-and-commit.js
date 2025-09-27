#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');
const chokidar = require('chokidar');

console.log('👁️ Starting file watcher for auto-commit...');

// Theo dõi các file quan trọng
const watcher = chokidar.watch([
    'client/src/**/*',
    'server/**/*',
    'ml-service/**/*',
    '*.json',
    '*.ts',
    '*.tsx',
    '*.js',
    '*.jsx',
    '*.py',
    '*.md'
], {
    ignored: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.git/**',
        '**/logs/**',
        '**/__pycache__/**',
        '**/*.pyc'
    ],
    persistent: true,
    ignoreInitial: true
});

let timeout;
const DELAY = 3000; // 3 giây delay

watcher.on('change', (path) => {
    console.log(`📝 File changed: ${path}`);

    // Clear timeout cũ
    if (timeout) {
        clearTimeout(timeout);
    }

    // Set timeout mới
    timeout = setTimeout(() => {
        console.log('🔄 Auto-committing changes...');

        try {
            // Kiểm tra có thay đổi không
            const status = execSync('git status --porcelain', { encoding: 'utf8' });

            if (status.trim()) {
                // Add và commit
                execSync('git add .');
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                execSync(`git commit -m "Auto-commit: ${timestamp} - ${path}"`);

                console.log('✅ Changes auto-committed and pushed!');
                console.log('🌐 Preview: https://huuduyenvnx-maker.github.io/newprojeck/');
            }
        } catch (error) {
            console.log('ℹ️ No changes to commit or error:', error.message);
        }
    }, DELAY);
});

console.log('✅ File watcher started! Changes will be auto-committed after 3 seconds of inactivity.');
console.log('Press Ctrl+C to stop watching...');