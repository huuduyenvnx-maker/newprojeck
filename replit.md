# Replit.md - AgriIntel Platform

## Overview

AgriIntel is an AI-powered agricultural intelligence platform that provides 30-day commodity price forecasting with dual-LLM verification. The system combines machine learning ensemble models (LightGBM, ARIMA, ETS) with OpenAI GPT-5 and Google Gemini 2.5 Pro for forecast verification and trading recommendations. Built as a full-stack web application using React, Express, and PostgreSQL with a focus on reliability scoring and confidence intervals.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript and Vite for development
- **UI Components**: Radix UI primitives with shadcn/ui design system
- **Styling**: Tailwind CSS with CSS variables for theming
- **State Management**: TanStack React Query for server state management
- **Routing**: Wouter for client-side routing
- **Charts**: Recharts for data visualization
- **Form Handling**: React Hook Form with Zod validation

### Backend Architecture
- **Framework**: Express.js with TypeScript running on Node.js
- **API Design**: RESTful API with JSON responses
- **Database ORM**: Drizzle ORM for type-safe database operations
- **Validation**: Zod schemas for request/response validation
- **File Structure**: Modular service-based architecture with separated concerns

### Data Storage
- **Primary Database**: PostgreSQL with Neon serverless hosting
- **Schema Management**: Drizzle Kit for migrations and schema management
- **Connection Pooling**: @neondatabase/serverless with WebSocket support
- **Data Models**: Users, commodities, regions, price data, forecasts, LLM verifications, alerts, and trading recommendations

### ML/AI Pipeline
- **Ensemble Models**: LightGBM (quantile/point) + ARIMA + ETS using Darts library
- **Hyperparameter Optimization**: Optuna for automated model tuning
- **Cross-validation**: Time-series appropriate rolling/blocked CV with backtesting
- **Confidence Intervals**: Quantile blending and Conformal Prediction (ICP/ACP)
- **Experiment Tracking**: MLflow for parameters, metrics, and model registry
- **Model Monitoring**: Evidently for data/target drift detection

### LLM Integration
- **Dual Verification**: OpenAI GPT-5 and Google Gemini 2.5 Pro for forecast validation
- **Response Format**: Structured JSON with application/json enforcement
- **Temperature Control**: Low temperature (0.0-0.4) for consistency
- **Quality Control**: Pydantic validation, deduplication, and quality filtering
- **Composite Confidence Score (CCS)**: Weighted average of LLM verification scores

### Authentication & Security
- **Session Management**: Express sessions with PostgreSQL store (connect-pg-simple)
- **API Security**: Input validation with Zod schemas
- **Environment Variables**: Secure configuration for API keys and database credentials

## External Dependencies

### Cloud Services
- **Database**: Neon PostgreSQL serverless database
- **AI Services**: OpenAI API (GPT-5) and Google Gemini API (2.5 Pro)

### Core Libraries
- **Frontend**: React, TanStack Query, Radix UI, Tailwind CSS, Recharts, Wouter
- **Backend**: Express.js, Drizzle ORM, Zod validation
- **Database**: PostgreSQL with Neon serverless adapter
- **AI/ML**: @google/genai for Gemini integration, OpenAI SDK
- **Development**: Vite, TypeScript, ESBuild for production builds

### Workflow & Monitoring
- **ML Pipeline**: Darts (time series), Optuna (HPO), MLflow (tracking), Evidently (monitoring)
- **Process Orchestration**: Airflow for production ML pipelines, GitHub Actions for lightweight workflows
- **Containerization**: Docker Compose with Nginx reverse proxy

### Data Processing
- **Time Series**: Darts library for ensemble forecasting
- **Date Handling**: date-fns for date manipulation
- **Validation**: Drizzle-zod for database schema validation
- **Utilities**: clsx and tailwind-merge for conditional styling