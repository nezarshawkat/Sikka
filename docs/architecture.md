# Sikka System Architecture

- **Mobile App (Flutter):** UI, route search, map rendering, offline region management, auth entry points.
- **Backend (Express):** REST APIs (`/route`, `/traffic`, `/taxi-price`, `/report-route`), input validation, Redis cache layer.
- **Routing Engine:** Multi-modal graph abstraction and pathfinding (Dijkstra + A*).
- **Database (PostgreSQL + PostGIS):** stops, routes, edges, live vehicles, user reports.
- **Admin Dashboard (React):** operations UI for route and report management.
- **Infra:** Docker compose for local orchestration.
