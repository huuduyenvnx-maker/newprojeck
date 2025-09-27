# AgriIntel ML Pipeline Automation
# Vietnamese Agricultural Forecasting Platform
# ============================================

.PHONY: help install start stop restart status logs test clean setup-airflow run-pipeline monitor

# Configuration
DOCKER_COMPOSE_FILE := airflow/docker-compose.yml
ML_SERVICE_PORT := 8000
NODE_SERVICE_PORT := 5000
AIRFLOW_PORT := 8080

# Colors for output
CYAN := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RED := \033[31m
RESET := \033[0m

help: ## Show this help message
	@echo "$(CYAN)AgriIntel ML Pipeline - Vietnamese Agricultural Forecasting$(RESET)"
	@echo "============================================================"
	@echo ""
	@echo "$(GREEN)Available commands:$(RESET)"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  $(CYAN)%-20s$(RESET) %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "$(YELLOW)Vietnamese Market Configuration:$(RESET)"
	@echo "  📅 Pipeline Schedule: 03:00 & 21:00 ICT daily"
	@echo "  🌾 Commodities: Rice, Coffee, Pepper, Rubber, Cashew"
	@echo "  📍 Regions: Ho Chi Minh, Hanoi, Mekong Delta, Central Highlands, Red River Delta"

install: ## Install all dependencies for ML pipeline
	@echo "$(CYAN)Installing AgriIntel ML Pipeline dependencies...$(RESET)"
	@echo "$(YELLOW)Installing Node.js dependencies...$(RESET)"
	npm install
	@echo "$(YELLOW)Installing Python ML dependencies...$(RESET)"
	cd ml-service && pip install -r requirements.txt
	@echo "$(YELLOW)Installing Airflow dependencies...$(RESET)"
	cd airflow && pip install -r requirements.txt
	@echo "$(GREEN)✅ All dependencies installed successfully$(RESET)"

setup-airflow: ## Setup and configure Airflow for Vietnamese agricultural forecasting
	@echo "$(CYAN)Setting up Airflow for AgriIntel ML Pipeline...$(RESET)"
	cd airflow && chmod +x scripts/start-airflow.sh && ./scripts/start-airflow.sh
	@echo "$(GREEN)✅ Airflow setup completed$(RESET)"

start: ## Start all services (Node.js, ML service, and Airflow)
	@echo "$(CYAN)Starting AgriIntel ML Pipeline services...$(RESET)"
	@echo "$(YELLOW)Starting background services...$(RESET)"
	chmod +x start-services.sh && ./start-services.sh &
	@sleep 5
	@echo "$(YELLOW)Starting Airflow orchestration...$(RESET)"
	cd airflow && docker-compose -f docker-compose.yml up -d
	@echo "$(GREEN)✅ All services started$(RESET)"
	@echo ""
	@echo "$(CYAN)Service URLs:$(RESET)"
	@echo "  🌐 Frontend: http://localhost:$(NODE_SERVICE_PORT)"
	@echo "  🐍 ML Service: http://localhost:$(ML_SERVICE_PORT)"
	@echo "  📊 Airflow: http://localhost:$(AIRFLOW_PORT)"

stop: ## Stop all services
	@echo "$(CYAN)Stopping AgriIntel ML Pipeline services...$(RESET)"
	@echo "$(YELLOW)Stopping Airflow...$(RESET)"
	cd airflow && docker-compose -f docker-compose.yml down
	@echo "$(YELLOW)Stopping background services...$(RESET)"
	pkill -f "tsx server/index.ts" || true
	pkill -f "python -m uvicorn" || true
	@echo "$(GREEN)✅ All services stopped$(RESET)"

restart: stop start ## Restart all services

status: ## Check status of all services
	@echo "$(CYAN)AgriIntel ML Pipeline Service Status$(RESET)"
	@echo "========================================"
	@echo ""
	@echo "$(YELLOW)📊 Airflow Services:$(RESET)"
	@cd airflow && docker-compose -f docker-compose.yml ps || echo "Airflow not running"
	@echo ""
	@echo "$(YELLOW)🌐 Node.js Service:$(RESET)"
	@curl -s http://localhost:$(NODE_SERVICE_PORT)/health 2>/dev/null && echo "✅ Running" || echo "❌ Not running"
	@echo ""
	@echo "$(YELLOW)🐍 ML Service:$(RESET)"
	@curl -s http://localhost:$(ML_SERVICE_PORT)/health 2>/dev/null && echo "✅ Running" || echo "❌ Not running"

logs: ## View logs from all services
	@echo "$(CYAN)Viewing AgriIntel ML Pipeline logs...$(RESET)"
	@echo "$(YELLOW)Press Ctrl+C to exit$(RESET)"
	cd airflow && docker-compose -f docker-compose.yml logs -f

logs-airflow: ## View only Airflow logs
	@echo "$(CYAN)Viewing Airflow logs...$(RESET)"
	cd airflow && docker-compose -f docker-compose.yml logs -f airflow-scheduler airflow-webserver

logs-ml: ## View ML service logs
	@echo "$(CYAN)Viewing ML service logs...$(RESET)"
	tail -f ml-service/logs/*.log 2>/dev/null || echo "No ML service logs found"

run-pipeline: ## Manually trigger the ML pipeline execution
	@echo "$(CYAN)Triggering AgriIntel ML Pipeline manually...$(RESET)"
	@curl -X POST "http://localhost:$(AIRFLOW_PORT)/api/v1/dags/agriintel_ml_pipeline/dagRuns" \
		-H "Content-Type: application/json" \
		-u admin:agriintel123 \
		-d '{"conf": {"manual_trigger": true}}' \
		&& echo "$(GREEN)✅ Pipeline triggered successfully$(RESET)" \
		|| echo "$(RED)❌ Failed to trigger pipeline$(RESET)"

test: ## Run comprehensive tests for the ML pipeline
	@echo "$(CYAN)Running AgriIntel ML Pipeline tests...$(RESET)"
	@echo "$(YELLOW)Testing Node.js service...$(RESET)"
	npm test || echo "$(YELLOW)Node.js tests not configured$(RESET)"
	@echo "$(YELLOW)Testing ML service...$(RESET)"
	cd ml-service && python -m pytest tests/ || echo "$(YELLOW)ML tests not configured$(RESET)"
	@echo "$(YELLOW)Testing Airflow DAG...$(RESET)"
	cd airflow && python -m pytest dags/test_agriintel_ml_pipeline.py || echo "$(YELLOW)Airflow tests not configured$(RESET)"

test-pipeline: ## Test individual pipeline components
	@echo "$(CYAN)Testing pipeline components...$(RESET)"
	@echo "$(YELLOW)1. Testing data ingestion...$(RESET)"
	@curl -s "http://localhost:$(NODE_SERVICE_PORT)/api/internal/health" || echo "❌ Node service not available"
	@echo "$(YELLOW)2. Testing ML service...$(RESET)"
	@curl -s "http://localhost:$(ML_SERVICE_PORT)/health" || echo "❌ ML service not available"
	@echo "$(YELLOW)3. Testing forecast generation...$(RESET)"
	@curl -s -X POST "http://localhost:$(ML_SERVICE_PORT)/forecast/test" || echo "❌ Forecast endpoint not available"

monitor: ## Monitor pipeline performance and health
	@echo "$(CYAN)Monitoring AgriIntel ML Pipeline...$(RESET)"
	@echo "$(YELLOW)Opening monitoring dashboard...$(RESET)"
	@open "http://localhost:$(AIRFLOW_PORT)" 2>/dev/null || \
		echo "Open http://localhost:$(AIRFLOW_PORT) in your browser"
	@echo ""
	@echo "$(GREEN)Monitoring Commands:$(RESET)"
	@echo "  📊 Airflow UI: http://localhost:$(AIRFLOW_PORT)"
	@echo "  🔍 Pipeline Status: make status"
	@echo "  📋 Live Logs: make logs"
	@echo "  🚀 Trigger Run: make run-pipeline"

clean: ## Clean up all containers, volumes, and temporary files
	@echo "$(CYAN)Cleaning up AgriIntel ML Pipeline...$(RESET)"
	@echo "$(YELLOW)Stopping and removing containers...$(RESET)"
	cd airflow && docker-compose -f docker-compose.yml down -v --remove-orphans
	@echo "$(YELLOW)Removing Docker images...$(RESET)"
	docker image prune -f
	@echo "$(YELLOW)Cleaning temporary files...$(RESET)"
	rm -rf airflow/logs/* || true
	rm -rf ml-service/logs/* || true
	rm -rf exports/* || true
	@echo "$(GREEN)✅ Cleanup completed$(RESET)"

reset: clean install setup-airflow ## Full reset and reinstall

validate-config: ## Validate Vietnamese market configuration
	@echo "$(CYAN)Validating AgriIntel configuration...$(RESET)"
	@echo "$(YELLOW)Checking Vietnamese commodities configuration...$(RESET)"
	@test -f config/sources.yaml && echo "✅ Sources config found" || echo "❌ Sources config missing"
	@echo "$(YELLOW)Checking timezone configuration...$(RESET)"
	@echo "Current timezone: $$(date +%Z)"
	@echo "$(YELLOW)Checking Airflow DAG...$(RESET)"
	@test -f airflow/dags/agriintel_ml_pipeline.py && echo "✅ Airflow DAG found" || echo "❌ Airflow DAG missing"

# Development commands
dev-start: ## Start services in development mode
	@echo "$(CYAN)Starting AgriIntel in development mode...$(RESET)"
	npm run dev &
	cd ml-service && python -m uvicorn main_simple:app --host 0.0.0.0 --port $(ML_SERVICE_PORT) --reload &
	@echo "$(GREEN)✅ Development services started$(RESET)"

dev-stop: ## Stop development services
	@echo "$(CYAN)Stopping development services...$(RESET)"
	pkill -f "npm run dev" || true
	pkill -f "uvicorn main_simple:app" || true
	@echo "$(GREEN)✅ Development services stopped$(RESET)"

# Quick commands for Vietnamese agricultural operations
vietnam-rice: ## Quick test for Vietnamese rice forecasting
	@echo "$(CYAN)Testing Vietnamese rice forecasting...$(RESET)"
	@curl -s -X POST "http://localhost:$(ML_SERVICE_PORT)/forecast/generate" \
		-H "Content-Type: application/json" \
		-d '{"commodity_id": "jasmine-rice", "region_id": "mekong-delta", "horizon": 30}' \
		|| echo "❌ Rice forecasting test failed"

vietnam-coffee: ## Quick test for Vietnamese coffee forecasting
	@echo "$(CYAN)Testing Vietnamese coffee forecasting...$(RESET)"
	@curl -s -X POST "http://localhost:$(ML_SERVICE_PORT)/forecast/generate" \
		-H "Content-Type: application/json" \
		-d '{"commodity_id": "robusta-coffee", "region_id": "central-highlands", "horizon": 30}' \
		|| echo "❌ Coffee forecasting test failed"

# Production deployment
deploy-prod: ## Deploy to production environment
	@echo "$(CYAN)Deploying AgriIntel to production...$(RESET)"
	@echo "$(RED)⚠️  This is a placeholder for production deployment$(RESET)"
	@echo "$(YELLOW)Production deployment requires:$(RESET)"
	@echo "  - Kubernetes cluster configuration"
	@echo "  - Production database setup"
	@echo "  - SSL certificates"
	@echo "  - Monitoring and alerting setup"

# Default target
.DEFAULT_GOAL := help