# AgriIntel Platform - Deployment Guide

## 📦 Export Package Contents

This deployment package contains everything needed to deploy AgriIntel to another platform:

```
deployment-export/
├── client/                 # React frontend application
├── server/                 # Express.js backend API
├── ml-service/            # Python ML forecasting service  
├── shared/                # Shared TypeScript types
├── database/              # Database backup and export scripts
├── environment/           # Environment configuration templates
├── instructions/          # This deployment guide
├── package.json           # Node.js dependencies
├── drizzle.config.ts     # Database ORM configuration
├── vite.config.ts        # Frontend build configuration
└── pyproject.toml        # Python ML service dependencies
```

## 🚀 Deployment Steps

### 1. Prerequisites

Install required software on your target platform:

```bash
# Node.js (v18+ recommended)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Python (3.11+ recommended)  
sudo apt-get install python3.11 python3.11-pip python3.11-venv

# PostgreSQL (v14+ recommended)
sudo apt-get install postgresql postgresql-contrib

# Git
sudo apt-get install git
```

### 2. Database Setup

**Create PostgreSQL Database:**
```bash
sudo -u postgres createuser agriintel --password
sudo -u postgres createdb agriintel_production --owner=agriintel
```

**Import Database:**
```bash
# Option 1: Full backup restore (if agriintel_full_backup.sql exists)
psql postgresql://agriintel:password@localhost:5432/agriintel_production < database/agriintel_full_backup.sql

# Option 2: Manual CSV import (run export_data.sql script first)
psql postgresql://agriintel:password@localhost:5432/agriintel_production -f database/export_data.sql
```

### 3. Environment Configuration

```bash
# Copy environment template
cp environment/.env.example .env

# Edit with your actual values
nano .env
```

**Required Environment Variables:**
- `DATABASE_URL`: Your PostgreSQL connection string
- `OPENAI_API_KEY`: OpenAI API key for GPT-5
- `GEMINI_API_KEY`: Google Gemini API key  
- `SESSION_SECRET`: Random string for session security

### 4. Application Deployment

**Install Dependencies:**
```bash
# Install Node.js dependencies
npm install

# Setup Python ML service
cd ml-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..
```

**Database Migration:**
```bash
# Generate and push database schema
npm run db:push
```

**Build Application:**
```bash
# Build frontend for production
npm run build
```

**Start Services:**
```bash
# Method 1: Using PM2 (recommended for production)
npm install -g pm2
pm2 start ecosystem.config.js

# Method 2: Direct start
npm run dev
```

### 5. Platform-Specific Instructions

#### **Heroku**
```bash
# Install Heroku CLI and login
heroku create agriintel-production
heroku addons:create heroku-postgresql:standard-0
heroku config:set OPENAI_API_KEY=your_key_here
heroku config:set GEMINI_API_KEY=your_key_here
git push heroku main
```

#### **DigitalOcean App Platform**
1. Upload this export package to GitHub
2. Connect DigitalOcean to your GitHub repo
3. Set environment variables in DO dashboard
4. Configure database addon

#### **AWS/GCP/Azure**
1. Setup VM instance
2. Install prerequisites
3. Follow deployment steps above
4. Configure reverse proxy (Nginx)
5. Setup SSL certificates

### 6. Production Configuration

**Nginx Reverse Proxy:**
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    location /api/ {
        proxy_pass http://localhost:5000/api/;
    }
}
```

**PM2 Ecosystem (ecosystem.config.js):**
```javascript
module.exports = {
  apps: [{
    name: 'agriintel-api',
    script: 'npm',
    args: 'start',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    }
  }, {
    name: 'agriintel-ml',
    script: 'python',
    args: 'ml-service/main.py',
    cwd: '.',
    interpreter: 'python3'
  }]
};
```

### 7. Health Checks

Test your deployment:
```bash
# API health check
curl http://localhost:5000/api/commodities

# ML service health check  
curl http://localhost:8000/health

# Frontend check
curl http://localhost:5000/
```

## 🔧 Troubleshooting

**Database Connection Issues:**
- Verify DATABASE_URL format: `postgresql://user:pass@host:port/db`
- Check PostgreSQL service is running
- Ensure database user has proper permissions

**ML Service Issues:**
- Install missing Python packages: `pip install package_name`
- Check port 8000 is available
- Verify Python 3.11+ is installed

**API Key Issues:**
- Verify OpenAI API key has correct permissions
- Check Gemini API is enabled in Google Cloud Console
- Ensure environment variables are loaded correctly

## 📞 Support

This deployment package contains a complete AgriIntel platform with:
- ✅ Dual-LLM verification (OpenAI + Gemini)
- ✅ 30-day forecasting with 15 Vietnamese commodities
- ✅ Complete database with 76 price records
- ✅ Production-ready configuration

For technical support, refer to the original documentation in `replit.md`.