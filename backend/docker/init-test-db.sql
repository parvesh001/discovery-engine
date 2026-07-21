-- Runs once, only against a fresh postgres_data volume (docker-entrypoint-initdb.d
-- scripts do not re-run against an existing volume). Creates a database isolated
-- from discovery_engine for integration tests, so test runs never touch dev data.
CREATE DATABASE discovery_engine_test;
\connect discovery_engine_test
CREATE EXTENSION IF NOT EXISTS vector;
