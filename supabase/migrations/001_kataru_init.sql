create extension if not exists pgcrypto;

create table if not exists public.kataru_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued',
  avatar_image_path text not null,
  product_image_path text not null,
  script_text text not null,
  voice_provider text,
  voice_id text,
  did_talk_id text,
  result_video_path text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kataru_jobs_status_idx on public.kataru_jobs (status);
create index if not exists kataru_jobs_created_at_idx on public.kataru_jobs (created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at_kataru_jobs on public.kataru_jobs;
create trigger set_updated_at_kataru_jobs
before update on public.kataru_jobs
for each row execute procedure public.set_updated_at();

alter table public.kataru_jobs enable row level security;

insert into storage.buckets (id, name, public)
values
  ('kataru-avatars', 'kataru-avatars', true),
  ('kataru-products', 'kataru-products', true),
  ('kataru-videos', 'kataru-videos', true)
on conflict (id)
do update set public = excluded.public;

drop policy if exists "Public read kataru assets" on storage.objects;
create policy "Public read kataru assets"
  on storage.objects
  for select
  using (bucket_id in ('kataru-avatars', 'kataru-products', 'kataru-videos'));

drop policy if exists "Anon upload kataru assets" on storage.objects;
create policy "Anon upload kataru assets"
  on storage.objects
  for insert
  with check (
    bucket_id in ('kataru-avatars', 'kataru-products', 'kataru-videos')
    and (auth.role() = 'anon' or auth.role() = 'authenticated')
  );
