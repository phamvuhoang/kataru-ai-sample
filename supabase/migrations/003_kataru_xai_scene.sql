alter table public.kataru_xai_jobs
  add column if not exists speaker_image_path text,
  add column if not exists scene_image_path text;
