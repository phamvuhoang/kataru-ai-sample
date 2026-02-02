create table if not exists public.kataru_xai_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued',
  product_image_path text not null,
  product_name text,
  product_description text,
  brand_tone text,
  scene_style text,
  motion_style text,
  aspect_ratio text,
  duration_seconds integer,
  resolution text,
  prompt text,
  xai_request_id text,
  result_video_path text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kataru_xai_jobs_status_idx on public.kataru_xai_jobs (status);
create index if not exists kataru_xai_jobs_created_at_idx on public.kataru_xai_jobs (created_at desc);

alter table public.kataru_xai_jobs enable row level security;

drop trigger if exists set_updated_at_kataru_xai_jobs on public.kataru_xai_jobs;
create trigger set_updated_at_kataru_xai_jobs
before update on public.kataru_xai_jobs
for each row execute procedure public.set_updated_at();
