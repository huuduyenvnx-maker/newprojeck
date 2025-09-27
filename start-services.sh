#!/bin/bash

# Production-ready startup script for AgriIntel ML Forecasting Services
# This script starts both Node.js and Python ML services with proper health checks

set -e  # Exit on any error

echo "🚀 Starting AgriIntel ML Forecasting Services..."

# Set environment variables
export NODE_ENV=${NODE_ENV:-development}
export ML_SERVICE_PORT=${ML_SERVICE_PORT:-8000}
export ML_SERVICE_HOST=${ML_SERVICE_HOST:-0.0.0.0}
export NODE_PORT=${NODE_PORT:-5000}
export ML_SERVICE_URL=${ML_SERVICE_URL:-http://localhost:8000}

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "❌ Port $port is already in use"
        return 1
    fi
    return 0
}

# Function to wait for service to be ready
wait_for_service() {
    local url=$1
    local service_name=$2
    local max_attempts=30
    local attempt=0
    
    echo "⏳ Waiting for $service_name to be ready at $url..."
    
    while [ $attempt -lt $max_attempts ]; do
        if curl -s -f "$url" > /dev/null 2>&1; then
            echo "✅ $service_name is ready!"
            return 0
        fi
        
        attempt=$((attempt + 1))
        echo "   Attempt $attempt/$max_attempts..."
        sleep 2
    done
    
    echo "❌ $service_name failed to start within timeout"
    return 1
}

# Check if ports are available
check_port $ML_SERVICE_PORT || exit 1
check_port $NODE_PORT || exit 1

echo "📦 Installing Python dependencies..."
cd ml-service
pip install -r requirements.txt > /dev/null 2>&1
cd ..

echo "📦 Installing Node.js dependencies..."
npm install > /dev/null 2>&1

# Start ML service in background
echo "🐍 Starting Python ML Service on port $ML_SERVICE_PORT..."
cd ml-service
python -m uvicorn main_simple:app --host $ML_SERVICE_HOST --port $ML_SERVICE_PORT --reload &
ML_PID=$!
cd ..

# Wait for ML service to be ready
if ! wait_for_service "http://localhost:$ML_SERVICE_PORT/health" "ML Service"; then
    kill $ML_PID 2>/dev/null || true
    exit 1
fi

# Start Node.js service in background  
echo "🚀 Starting Node.js Service on port $NODE_PORT..."
NODE_ENV=development tsx server/index.ts &
NODE_PID=$!

# Wait for Node.js service to be ready
if ! wait_for_service "http://localhost:$NODE_PORT" "Node.js Service"; then
    kill $ML_PID 2>/dev/null || true
    kill $NODE_PID 2>/dev/null || true
    exit 1
fi

echo "🎉 Both services are running successfully!"
echo "   📊 Node.js Service: http://localhost:$NODE_PORT"
echo "   🤖 ML Service: http://localhost:$ML_SERVICE_PORT"
echo "   🏥 ML Health Check: http://localhost:$ML_SERVICE_PORT/health"

# Function to cleanup on exit
cleanup() {
    echo "🛑 Shutting down services..."
    kill $ML_PID 2>/dev/null || true
    kill $NODE_PID 2>/dev/null || true
    echo "👋 Services stopped"
    exit 0
}

# Trap cleanup function on script exit
trap cleanup SIGINT SIGTERM EXIT

# Keep script running and monitor services
echo "🔍 Monitoring services... (Press Ctrl+C to stop)"
while true; do
    # Check if processes are still running
    if ! kill -0 $ML_PID 2>/dev/null; then
        echo "❌ ML Service process died"
        cleanup
    fi
    
    if ! kill -0 $NODE_PID 2>/dev/null; then
        echo "❌ Node.js Service process died"
        cleanup
    fi
    
    sleep 5
done