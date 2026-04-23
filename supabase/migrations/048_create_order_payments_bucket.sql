-- Ensure payment screenshot storage bucket exists.
-- Used by buyer payment proof uploads and seller refund proof uploads.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-payments',
  'order-payments',
  false,
  5242880,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

