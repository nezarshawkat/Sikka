# API Documentation

Base URL: `/api/v1`

## Health
- `GET /health`

## Route planning
- `GET /route`
- Query:
  - `start_lat`
  - `start_lng`
  - `end_lat`
  - `end_lng`
  - `route_type` (`cheapest|fastest|balanced|comfort|tourist`)

## Traffic
- `GET /traffic`
- Query: `lat`, `lng`

## Taxi estimate
- `GET /taxi-price`
- Query: `start_lat`, `start_lng`, `end_lat`, `end_lng`

## User reports
- `POST /report-route`
- Body: `report_type`, `description`, `lat`, `lng`, `status`

## Authentication
- `POST /auth/google-signup`
  - Body: `idToken`
- `POST /auth/phone-signup/start`
  - Body: `phone`
- `POST /auth/phone-signup/verify`
  - Body: `phone`, `code`
