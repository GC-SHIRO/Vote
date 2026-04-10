# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Frontend (root directory):**
- `npm install` - Install frontend dependencies
- `npm run dev` - Start Vite dev server on port 5173
- `npm run build` - Build frontend for production (output to `dist/`)
- `npm run preview` - Preview production build locally

**Backend (from `backend/` directory):**
- `npm install` - Install backend dependencies
- `cp .env.example .env` - Copy environment template, edit with your config
- `npm run init-db` - Initialize MySQL database with schema
- `npm run dev` - Start dev server with auto-reload on port 8080
- `npm run start` - Start production server
- `node scripts/load-test.js <concurrency> <total>` - Run load testing

**Default Admin Credentials:**
- Username: `admin`
- Password: `131072`
- Authentication: HTTP Basic Auth

## Architecture

This is a full-stack campus singing competition voting application:

- **Frontend**: React 19 + TypeScript + Vite. Two entry points:
  - `src/App.tsx` - Public voting page for students
  - `src/AdminApp.tsx` - Admin dashboard for management

- **Backend**: Node.js + Express (ES modules). RESTful API:
  - `backend/src/server.js` - Entry point
  - `backend/src/app.js` - Express app with route definitions
  - `backend/src/db.js` - MySQL database connection
  - `backend/src/redis.js` - Optional Redis connection for caching
  - `backend/src/config.js` - Configuration loading from environment

- **Database**: MySQL for persistent storage (candidates, votes, admin user). Redis is optional for caching.

**Three-tier architecture** with clear separation between frontend, backend API, and database.

## Key Features

- **Public voting**: Single-choice or multiple-choice configurable voting
- **Student ID validation**: 12-digit validation with year-based checking
- **Vote deduplication**: Device fingerprinting to prevent repeat voting
- **Real-time results**: Live ranking of candidates
- **Admin dashboard**: Complete management interface:
  - Start/stop voting
  - Configure voting mode
  - Toggle results visibility
  - CRUD operations for candidates
  - Avatar upload support
  - Lottery system with rollback capability

## Documentation

Detailed documentation is available in the `docs/` directory:
- `FRONTEND.md` - Frontend capabilities and running instructions
- `BACKEND.md` - Backend API documentation
- `ADMIN.md` - Admin feature guide
- `DEPLOY.md` - Complete production deployment guide
- `DEPLOY_QUICK.md` - Quick deployment instructions
- `LOAD_TESTING.md` - Load testing guide
- `UPDATE_FLOW.md` - Production update process

## Environment Variables

**Frontend (root `.env`):**
- `VITE_API_BASE_URL` - Backend API base URL (default: `http://localhost:8080`)
- `VITE_USE_MOCK` - Enable mock API (true/false)

**Backend (`backend/.env`):**
- `DB_HOST` - MySQL host
- `DB_PORT` - MySQL port
- `DB_USER` - MySQL username
- `DB_PASSWORD` - MySQL password
- `DB_NAME` - MySQL database name
- `REDIS_URL` - Redis connection URL (optional)
- `PORT` - Backend server port (default: 8080)
