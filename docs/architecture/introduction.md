# Introduction

This document outlines the overall project architecture for DSPanel, including the application structure, services, data models, and non-UI specific concerns. Its primary goal is to serve as the guiding architectural blueprint for AI-driven development, ensuring consistency and adherence to chosen patterns and technologies.

DSPanel is a cross-platform desktop application built with Tauri v2 (Rust backend) and React/TypeScript (frontend). The Rust backend handles all system-level operations (LDAP, file I/O, database) while the React frontend provides the user interface, communicating via Tauri's IPC command system.

### Starter Template or Existing Project

N/A - This is a greenfield project scaffolded with `cargo create-tauri-app` using the React/TypeScript template with Vite bundler. No starter template or existing codebase is used as foundation.

### Change Log

| Date       | Version | Description                                   | Author    |
| ---------- | ------- | --------------------------------------------- | --------- |
| 2026-03-10 | 0.1     | Initial architecture document                 | Romain G. |
| 2026-03-13 | 0.2     | Migration to Rust/Tauri v2 + React/TypeScript | Romain G. |

---
