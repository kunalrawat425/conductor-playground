-- Remove the legacy 12-parameter overload of create_order_atomic.
-- Migration 023 added a 14-parameter version with defaults on the last two args;
-- PostgreSQL then treats calls as ambiguous between the old 12-arg and new 14-arg functions.
drop function if exists public.create_order_atomic(
  uuid,
  text,
  numeric,
  text,
  text,
  uuid,
  text,
  numeric,
  numeric,
  text,
  text,
  timestamptz,
  uuid
);
