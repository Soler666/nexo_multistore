<div align="center">

# Nexo Comercial

**Plataforma multi-sucursal de punto de venta, inventario y supervisión de equipos.**

[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-18-149eca?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06b6d4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Express](https://img.shields.io/badge/Express-4-222222?logo=express)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-5-2d3748?logo=prisma)](https://www.prisma.io/)
[![SQLite](https://img.shields.io/badge/SQLite-local-003b57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?logo=socket.io)](https://socket.io/)
[![pnpm](https://img.shields.io/badge/pnpm-8-f69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Turborepo](https://img.shields.io/badge/Turborepo-2-ef4444?logo=turborepo&logoColor=white)](https://turbo.build/)

</div>

## Tabla de contenido

- [Resumen](#resumen)
- [Funcionalidades](#funcionalidades)
- [Arquitectura](#arquitectura)
- [Roles y permisos](#roles-y-permisos)
- [Flujos de acceso](#flujos-de-acceso)
- [Modelo de datos](#modelo-de-datos)
- [Tiempo real](#tiempo-real)
- [API REST](#api-rest)
- [Instalación local](#instalación-local)
- [Configuración de Google OAuth](#configuración-de-google-oauth)
- [Comandos](#comandos)
- [Seguridad y producción](#seguridad-y-producción)

## Resumen

Nexo permite administrar varios negocios y sucursales desde una plataforma central. Cada organización gestiona su catálogo, existencias, ventas, personal y solicitudes de acceso. El código valida organización, sucursal y rol en el servidor; la navegación del frontend es una ayuda visual, no el límite de seguridad.

SQLite se usa para desarrollo local y no requiere instalar un servidor. El archivo `packages/db/dev.db` se crea con Prisma y se excluye de Git. Para despliegues multiusuario se debe migrar a una base de datos administrada, normalmente PostgreSQL.

## Funcionalidades

- Acceso y registro inicial mediante Google OAuth y correo verificado.
- Alta de organización y primera sucursal por el propietario, o alta central por el administrador de plataforma.
- Códigos de ingreso, solicitud de rol/sucursal y aprobación o rechazo por el propietario.
- POS con precios e impuestos calculados en servidor, numeración por sucursal y descuento transaccional de existencias.
- Inventario por sucursal, umbral de stock bajo, búsqueda, filtros, paginación y ajustes auditados.
- Archivado de productos: los saca de nuevas ventas y traslados sin borrar comprobantes históricos.
- Traslados con aprobación en destino y movimientos de inventario transaccionales.
- Comprobantes PDF con QR de verificación y exportación de reportes CSV/PDF.
- Auditoría y eventos en vivo para ventas, inventario, traslados, equipo y solicitudes.

## Arquitectura

```text
apps/
  web/                 Next.js App Router, React Query, Recharts, Tailwind
  api/                 Express REST, Passport Google OAuth, Socket.IO
packages/
  db/                  Prisma Client y schema.prisma (SQLite local)
  types/               Roles, estados y DTO compartidos
  ui/                  Componentes React compartidos
```

**Web:** Next.js 14, React 18, TypeScript, TanStack Query, Recharts, Tailwind CSS y Lucide.

**API:** Node.js, Express 4, Passport Google OAuth 2.0, JWT en cookies `HttpOnly`, Zod, Socket.IO, PDFKit y QRCode.

**Datos:** Prisma 5, SQLite para desarrollo. Las ventas e inventario usan importes `Decimal`; el detalle de auditoría se guarda como JSON serializado porque SQLite no soporta el tipo `Json` de Prisma 5.

**Monorepo:** pnpm Workspaces y Turborepo 2.

## Roles y permisos

| Rol | Ámbito | Acceso principal |
| --- | --- | --- |
| `SUPER_ADMIN` | Plataforma completa | Crear organizaciones/propietarios, supervisar actividad global y resolver solicitudes de acceso. Se asigna solo al correo verificado configurado en `SUPER_ADMIN_EMAIL`. |
| `STORE_OWNER` | Todas las sucursales de su organización | Dashboard consolidado, equipo, aprobación de solicitudes, sucursales, inventario, traslados y reportes. No opera la caja. |
| `BRANCH_MANAGER` | Su sucursal | Dashboard, catálogo/inventario, ajustes, traslados y reportes de su sede. No puede completar ventas. |
| `CASHIER` | Su sucursal | POS y comprobantes de sus propias ventas. No administra productos, existencias, equipo, traslados ni reportes consolidados. |
| `UNASSIGNED` | Sin organización | Puede crear un negocio propio o pedir acceso con el código del propietario. No puede operar hasta ser asignado. |

La API vuelve a leer el rol, estado y sucursal actuales del usuario en cada solicitud. Si el propietario cambia permisos o desactiva una cuenta, se revocan también sus sockets conectados.

## Flujos de acceso

### Administrador de plataforma

1. Configura `SUPER_ADMIN_EMAIL` con el correo exacto de una cuenta Google verificada.
2. Inicia sesión con esa cuenta; solo ese correo recibe `SUPER_ADMIN`.
3. En `/platform` crea organización, primera sucursal y asigna el correo del propietario.
4. Revisa solicitudes globales y la actividad auditada.

### Propietario

1. En el primer acceso Google elige crear su organización; el onboarding crea la primera sucursal y le asigna `STORE_OWNER`.
2. Desde Equipo comparte el código de ingreso o invita directamente a una persona por correo.
3. Revisa solicitudes pendientes y aprueba/rechaza el rol y sucursal solicitados.
4. Administra todas las sucursales de su organización.

### Gerente o cajero

1. Inicia sesión con Google usando el correo al que se le dio acceso.
2. Introduce el código de la organización, elige sucursal y solicita `BRANCH_MANAGER` o `CASHIER`.
3. Hasta la aprobación permanece sin acceso operativo.
4. Tras aprobarse, la sesión recibe el rol y sucursal asignados; el menú y la API reflejan esos permisos.

## Modelo de datos

El esquema está en [`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma).

- `Organization`: razón social, identificación tributaria, moneda, tasa de impuesto y código de ingreso.
- `Branch`: sucursal, tipo de negocio y secuencia de comprobantes.
- `User`: identidad Google, organización/sucursal, rol y estado.
- `AccessRequest`: solicitante, organización, sucursal, rol pedido, estado y decisor.
- `Product` / `BranchInventory`: catálogo por organización y existencias/precio por sucursal.
- `Sale` / `SaleItem`: comprobantes, vendedor, moneda configurada, importes e impuesto.
- `StockTransfer` / `TransferItem`: origen, destino, aprobación y artículos.
- `AuditLog`: actor, acción, entidad, detalle serializado y fecha.
- `RefreshToken`: hash del token, expiración y revocación.

El archivado marca `Product.isActive = false`. No se elimina en cascada porque sus referencias pueden formar parte de ventas ya cobradas.

## Tiempo real

Socket.IO autentica el handshake con la cookie de acceso y carga el usuario activo desde SQLite:

- `SUPER_ADMIN`: sala `platform`.
- `STORE_OWNER`: sala `organization:<id>`.
- `BRANCH_MANAGER` y `CASHIER`: sala `branch:<id>`.
- Cada usuario: sala privada `user:<id>` para su decisión de acceso.

Eventos de servidor: `organization:activity`, `platform:activity` y `access:decision`. Las emisiones se hacen después de confirmar la transacción. El cliente invalida cachés TanStack Query de dashboard, inventario, ventas, traslados y equipo. En espera de aprobación hay polling de respaldo cada cinco segundos.

En producción con varias instancias de API se debe configurar el adaptador Redis de Socket.IO y afinidad de sesión si se mantiene long-polling.

## API REST

Todas las rutas de negocio requieren JWT, salvo el callback Google y la verificación pública de recibos.

| Método | Ruta | Uso / permiso |
| --- | --- | --- |
| `GET` | `/api/auth/google` | Inicia Google OAuth. |
| `GET` | `/api/auth/google/callback` | Registra/inicia sesión y dirige a plataforma, onboarding o acceso. |
| `POST` | `/api/auth/refresh` | Rota refresh token. |
| `POST` | `/api/auth/logout` | Revoca refresh token y cookies. |
| `GET` | `/api/auth/me` | Usuario y permisos vigentes. |
| `POST` | `/api/onboarding` | Crea organización y primera sucursal para un usuario sin asignar. |
| `GET` | `/api/access/me` | Solicitudes y estado de acceso del usuario. |
| `GET` | `/api/access/organizations/:joinCode` | Busca negocio y sucursales mediante código. |
| `POST` | `/api/access/requests` | Solicita rol/sucursal. |
| `GET` | `/api/access/requests` | Solicitudes de la organización (propietario) o globales (Super Admin). |
| `POST` | `/api/access/requests/:id/decision` | Aprueba/rechaza y asigna rol/sucursal en una transacción. |
| `GET` | `/api/access/join-code` | Consulta el código del propietario. |
| `POST` | `/api/access/join-code/rotate` | Rota el código de ingreso. |
| `GET` | `/api/platform/overview` | Resumen de plataforma (Super Admin). |
| `POST` | `/api/platform/organizations` | Crea negocio, primera sucursal y propietario (Super Admin). |
| `GET/POST` | `/api/branches` | Lista o crea sucursales; crear requiere propietario. |
| `GET/POST` | `/api/users` | Lista/invita equipo; propietario. |
| `PATCH` | `/api/users/:id` | Cambia rol/sucursal/estado; propietario. |
| `GET/POST` | `/api/sales` | Historial propietario/gerente; venta solo Cajero. |
| `POST` | `/api/sales/:id/cancel` | Anula y repone stock con auditoría. |
| `GET` | `/api/inventory` | Inventario; Cajero solo lectura de su sucursal para POS. |
| `POST` | `/api/inventory/products` | Crea producto y existencias iniciales; propietario/gerente. |
| `DELETE` | `/api/inventory/products/:productId` | Archiva producto; solo propietario. |
| `PATCH` | `/api/inventory/:inventoryId/adjust` | Ajuste auditado; propietario/gerente de la sede. |
| `GET/POST` | `/api/transfers` | Lista/solicita traslados; Cajero no tiene acceso. |
| `POST` | `/api/transfers/:id/accept\|reject\|complete` | Decisión de traslado en destino. |
| `GET` | `/api/reports/summary` | KPIs, sedes, productos destacados y stock bajo. |
| `GET` | `/api/reports/activity` | Actividad reciente con alcance por organización/sucursal. |
| `GET` | `/api/reports/sales.csv` | Exportación CSV. |
| `GET` | `/api/reports/sales.pdf` | Exportación PDF. |
| `GET` | `/api/receipts/:saleId.pdf` | Comprobante PDF con QR, dentro del ámbito permitido. |
| `GET` | `/api/receipts/verify/:token` | Verifica un comprobante por token aleatorio. |

## Instalación local

Requisitos: Node.js 20+, pnpm 8+ y credenciales OAuth de Google. No hace falta instalar SQLite; Prisma crea el archivo local.

```powershell
pnpm install
Copy-Item .env.example .env
```

Configura en `.env`:

- `DATABASE_URL="file:../dev.db"` (base local en `packages/db/dev.db`).
- `ACCESS_TOKEN_SECRET` (secreto aleatorio de al menos 32 bytes; no uses el valor de ejemplo en producción).
- `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.
- `SUPER_ADMIN_EMAIL` (correo Google verificado para el administrador global; no es obligatorio para el desarrollo normal).
- `GOOGLE_CALLBACK_URL="http://localhost:4000/api/auth/google/callback"`.
- `WEB_ORIGIN="http://localhost:3000"` y `NEXT_PUBLIC_API_URL="http://localhost:4000"`.

Prepara datos y ejecuta:

```powershell
pnpm db:generate
pnpm db:push
pnpm dev
```

Web: `http://localhost:3000`. API: `http://localhost:4000`. Si los puertos están ocupados, libera los procesos previos o configura puertos alternativos.

### Google Cloud Console

Configura el cliente OAuth de tipo **Aplicación web**:

- Orígenes autorizados de JavaScript: `http://localhost:3000`.
- URI de redireccionamiento autorizada: `http://localhost:4000/api/auth/google/callback`.

En producción, configura las variables de entorno del backend (por ejemplo, en Render):

- `WEB_ORIGIN="https://nexo-multistore.vercel.app"`.
- `API_PUBLIC_URL="https://nexo-multistore.onrender.com"`.
- `GOOGLE_CALLBACK_URL="https://nexo-multistore.onrender.com/api/auth/google/callback"`.

En Google Cloud Console registra como origen JavaScript autorizado `https://nexo-multistore.vercel.app` y como URI de redireccionamiento autorizado `https://nexo-multistore.onrender.com/api/auth/google/callback`. Si `GOOGLE_CALLBACK_URL` no está configurada en producción, el backend la deriva de `API_PUBLIC_URL`; si tampoco existe esta última, el backend indica el error de configuración en vez de enviar a `localhost`.

## Comandos

| Comando | Descripción |
| --- | --- |
| `pnpm dev` | Web y API en modo desarrollo con Turbo. |
| `pnpm build` | Build de todos los paquetes/aplicaciones. |
| `pnpm lint` | Typecheck definido para API y web. |
| `pnpm typecheck` | Typecheck de los paquetes configurados. |
| `pnpm db:generate` | Genera Prisma Client y paquete `@repo/db`. |
| `pnpm db:push` | Sincroniza el esquema con la SQLite local. |

## Seguridad y producción

- No subas `.env`, `packages/db/dev.db`, tokens, `client_secret` ni credenciales. `.gitignore` excluye `.env*` (excepto `.env.example`) y `*.db`.
- El refresh token se almacena con hash; las cookies son `HttpOnly`, y OAuth usa `state` aleatorio.
- El backend valida sesión, estado, rol, organización y sucursal; no confía en identificadores de permisos enviados por el cliente.
- Ventas y traslados son transaccionales; los cambios críticos se registran en `AuditLog`.
- SQLite local es para desarrollo/una instancia; no desplegar el archivo como base compartida. Para producción, cambia el proveedor Prisma a PostgreSQL, migra/valida los campos (SQLite almacena roles y estados como texto), crea migraciones revisadas y configura backups.
- Para varias instancias, habilita adaptador Redis para Socket.IO, TLS, CORS exacto, rate limiting, monitoreo y rotación de secretos.
- El PDF/QR es un comprobante interno de verificación; no sustituye facturación electrónica certificada del país.
- Antes de producción: pruebas de integración de permisos/ventas, recuperación de backup, política de retención, revisión legal de datos y prueba de concurrencia.
