# Aptech Airlines database

MongoDB is intentionally independent from the application compose file. It can run on the same machine or a dedicated database machine.

## Start MongoDB

```bash
cd database
docker compose up -d mongodb
```

The default host port is `27018`.

## First-time bootstrap

Run the database bootstrap tool interactively:

```bash
docker compose --profile tools run --rm bootstrap
```

The tool loads baseline airport/cancellation-policy data. If no SUPER_ADMIN exists, it asks for username, email, name and password, hashes the password with bcrypt, and writes the administrator directly to MongoDB.

SUPER_ADMIN credentials are **not** stored in `.env`, and the NestJS backend does **not** auto-create an administrator on startup.

## Demo / grading dataset

For a fresh machine that needs usable flights immediately, run the bootstrap with demo mode:

```bash
docker compose --profile tools run --rm bootstrap --demo
```

This mode is idempotent and adds a small rolling dataset with future dates: SGN-HAN direct/round-trip coverage, HAN-DAD-PQC and SGN-SIN-LAX connecting coverage, SGN-NRT international coverage, a seat-map flight, sample confirmed/blocked bookings, and local CUSTOMER/CLERK/ADMIN accounts.

All demo flights use the same customer-bookable invariant as the backend (`operator=APTECH_AIRLINES`, `data_source=AIRLABS_COMMERCIALIZED`, `is_bookable=true`) and all demo inventories are non-smoking.

Local demo accounts:

```text
demo_customer
demo_clerk
demo_admin
password: DemoPass@2026
```

These are grading/test accounts only. SUPER_ADMIN remains separate, is created from the interactive prompt, and is never hard-coded in the application environment.

## Application connection

If backend Docker runs on the same Mac/Windows host:

```env
MONGO_URI=mongodb://host.docker.internal:27018/airline_db
```

If MongoDB runs on another machine, set `MONGO_URI` to that machine's reachable MongoDB connection string.
# Legacy database tooling

Thư mục này chỉ được giữ lại để tham khảo công cụ bootstrap cũ. Luồng chạy chính của dự án **không sử dụng** compose/bootstrap trong thư mục này.

Hãy chạy `docker compose up -d --build` tại thư mục gốc. Compose gốc khởi chạy đúng 3 service `mongodb`, `backend`, `frontend`; MongoDB khởi tạo trống và dữ liệu được quản trị thủ công qua MongoDB Compass/Admin hoặc giao diện/API quản trị.
