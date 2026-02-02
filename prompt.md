Please analyze the current Kataru AI codebase to understand existing features (D-ID lip-sync video generation and xAI commercial video generation), then complete the following tasks in sequence:

## Task 1: Detailed Implementation Plan
Create a comprehensive implementation plan including:

### 1.1 Work Breakdown Structure (WBS)
- Break down all tasks with status tracking (✅/⬜), dependencies, complexity (S/M/L), and acceptance criteria
- Organize into logical phases (e.g., Auth Setup, Database Schema, Edge Functions, Frontend UI, Testing)

### 1.2 Database Schema
Design PostgreSQL tables for:
- **users** table (extends Supabase Auth): user_id (UUID, FK to auth.users), display_name, avatar_url, bio, created_at, updated_at
- **shared_videos** table: id (UUID), user_id (FK), video_url, video_type (enum: 'lipsync' | 'xai'), title, description, thumbnail_url, likes_count, comments_count, created_at, updated_at
- **video_likes** table: id (UUID), video_id (FK), user_id (FK), created_at, with unique constraint on (video_id, user_id)
- **video_comments** table: id (UUID), video_id (FK), user_id (FK), comment_text, created_at, updated_at
- Include RLS policies for each table following the project's security model

### 1.3 API Contracts (Edge Functions)
Define Zod schemas and endpoints for:
- `POST /functions/v1/kataru/auth/signup` - email/password signup
- `POST /functions/v1/kataru/auth/signin` - email/password signin
- `POST /functions/v1/kataru/videos/share` - share generated video to public gallery
- `GET /functions/v1/kataru/videos/shared` - fetch paginated public videos with filters/sorting
- `GET /functions/v1/kataru/videos/shared/:id` - get single video details with comments
- `POST /functions/v1/kataru/videos/:id/like` - toggle like on video
- `POST /functions/v1/kataru/videos/:id/comment` - add comment to video
- `GET /functions/v1/kataru/profile/:userId` - get user profile with video history
- `PATCH /functions/v1/kataru/profile` - update current user profile

Include request/response Zod schemas for each endpoint.

## Task 2: Full Implementation
Implement all features in one comprehensive update:

### 2.1 Backend (Supabase)
- Create migration files in `supabase/migrations/` for all new tables with RLS policies
- Implement all Edge Function routes in `supabase/functions/kataru/index.ts` (or modularize into separate files)
- Add Zod schemas to `supabase/functions/kataru/_shared/schemas.ts`
- Ensure all database operations use RPC functions (SECURITY DEFINER) following project architecture

### 2.2 Frontend (Next.js)
- **Auth pages**: Create `/app/signin/page.tsx` and `/app/signup/page.tsx` with email/password forms using Supabase Auth client-side
- **Public gallery page**: Create `/app/gallery/page.tsx` with infinite scroll/pagination, video grid layout, like/comment functionality (requires sign-in)
- **Video detail page**: Create `/app/gallery/[videoId]/page.tsx` with video player, metadata, comments section, share button (generates shareable link + text for Twitter/Facebook/LINE)
- **Profile page**: Create `/app/profile/page.tsx` showing current user's info and generated video history with edit capability
- **Share modal/flow**: Add "Share to Gallery" button after video generation completes (both lip-sync and xAI modes) in `/app/page.tsx`
- Use shadcn/ui components, Tailwind CSS, and React Query for data fetching
- Implement minimalist, modern UI with smooth animations and excellent UX (inspired by TikTok/Instagram Reels for video browsing)

### 2.3 Integration
- Update existing video generation flows to optionally save to `shared_videos` table
- Add authentication middleware/guards for protected routes
- Implement client-side Supabase session management

## Task 3: Documentation
Create a concise setup and testing guide in `docs/SETUP_AND_TESTING.md` with:
- Prerequisites (Node.js version, Supabase CLI)
- Environment variables setup (including any new auth-related vars)
- Database migration steps (`supabase db push` or manual SQL execution)
- Edge Functions deployment commands
- Local development server startup
- Testing instructions:
  - How to test signup/signin flow
  - How to generate and share a video
  - How to view public gallery and interact (like/comment)
  - How to access profile page
  - How to test share-to-SNS functionality
- Troubleshooting common issues

Keep the documentation clean, short, and actionable with clear step-by-step commands.
