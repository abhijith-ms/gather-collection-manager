insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('branding','branding',false,1048576,array['image/png','image/jpeg','image/webp']) on conflict(id) do nothing;

create policy branding_read on storage.objects for select to authenticated
using(bucket_id='branding' and public.app_ready());
-- Uploads go through the admin-only server route; old versions stay available for receipt snapshots.
