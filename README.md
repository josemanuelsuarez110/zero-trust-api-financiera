# Zero-Trust Financial API (Node.js + PostgreSQL)

Este es el backend API REST para el **Sistema de Gestión Financiera "Zero-Trust"**, diseñado para integrarse con PostgreSQL (Neon Serverless) con validaciones directas en la base de datos utilizando JWT y Row-Level Security (RLS).

## 🚀 Despliegue Rápido en Vercel

Puedes desplegar esta API directamente a tu cuenta de Vercel con un solo clic:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%20%2F%2Fgithub.com%2Fjosemanuelsuarez110%2Fzero-trust-api-financiera&env=JWT_SECRET,DATABASE_URL)

### Variables de Entorno Requeridas
Al desplegar, Vercel te pedirá las siguientes variables de entorno:
* `DATABASE_URL`: El connection string de tu base de datos Neon (Manten el sufijo `?sslmode=require`).
* `JWT_SECRET`: Una clave secreta para firmar los JSON Web Tokens (ej. `mi-clave-super-secreta-2026`).

## 🛡️ Características de Seguridad
* **Autenticación Basada en Roles (RBAC):** Login ficticio integrado para testing rápido de permisos.
* **Row-Level Security (RLS) en Postgres:** Inyección dinámica de variables de sesión (`app.current_rol` y `app.current_sucursal`) por cada consulta HTTP para garantizar aislamiento transaccional a nivel de base de datos.
* **Anonimización Criptográfica:** Endpoints públicos que devuelven resultados ofuscados (con hash).
* **Pool Configuration:** Optimizado para Vercel Serverless Functions y Edge (`max: 1`).
