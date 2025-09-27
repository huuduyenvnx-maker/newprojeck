#!/usr/bin/env node

const { execSync } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function autoCommit() {
    try {
        console.log('🔄 Checking for changes...');

        // Kiểm tra xem có thay đổi không
        const status = execSync('git status --porcelain', { encoding: 'utf8' });

        if (!status.trim()) {
            console.log('✅ No changes to commit');
            return;
        }

        console.log('📝 Changes detected:');
        console.log(status);

        // Hỏi commit message
        const message = await new Promise((resolve) => {
            rl.question('💬 Enter commit message (or press Enter for auto-message): ', (answer) => {
                resolve(answer.trim() || `Auto-commit: ${new Date().toISOString()}`);
            });
        });

        // Add all changes
        console.log('📦 Adding changes...');
        execSync('git add .');

        // Commit
        console.log('💾 Committing...');
        execSync(`git commit -m "${message}"`);

        console.log('✅ Auto-commit completed!');
        console.log('🚀 Code will be automatically pushed to GitHub via Git hook');
        console.log('🌐 Preview will be available at: https://huuduyenvnx-maker.github.io/newprojeck/');

    } catch (error) {
        console.error('❌ Error during auto-commit:', error.message);
    } finally {
        rl.close();
    }
}

autoCommit();