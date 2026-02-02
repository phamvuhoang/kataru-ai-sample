# Kataru AI

AI商品説明ビデオ自動生成デモ（D-ID API）。

## Getting Started

Follow these steps to set up and run the project locally.

### 1. Clone the repository
```bash
git clone https://github.com/phamvuhoang/kataru-ai-sample.git
cd kataru-ai-sample
```

### 2. Install dependencies
- **Node.js**: Recommended version 20.x or higher.
- **Package Manager**: npm or pnpm.

```bash
npm install
# or
pnpm install
```

### 3. D-ID API Setup
- Register for a free account at [D-ID Studio](https://studio.d-id.com).
- Go to API settings and generate an API key. 
- **Important**: The API key needs to be base64-encoded.
  - Format: `Basic <base64(username:password)>`
  - **How to encode**: Run this command in your terminal:
    ```bash
    echo -n "api_username:api_password" | base64
    ```
    Replace `api_username` and `api_password` with your D-ID credentials.

### 4. Supabase Project Setup
- Create a free account at [Supabase](https://supabase.com).
- Create a new project and copy these values:
  - Project Reference ID
  - Project URL
  - Anon Key
  - Service Role Key
- Install Supabase CLI:
```bash
npm install -g supabase
```
- Login and link your project:
```bash
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>
```

### 5. Environment Variables
Create a `.env.local` file in the root directory and add the following variables (refer to `.env.example`):

```bash
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
D_ID_API_KEY=Basic <YOUR_BASE64_ENCODED_KEY>
D_ID_API_URL=https://api.d-id.com
XAI_API_KEY=your-xai-api-key (optional)
XAI_API_URL=https://api.x.ai (optional)
```

### 6. Run Database Migrations
Push the database schema to your Supabase project:
```bash
supabase db push
```
Alternatively, you can manually execute the SQL files found in `supabase/migrations/` via the Supabase Dashboard SQL Editor.

### 7. Deploy Edge Functions
Set the required secrets in Supabase and deploy the functions. You can use this snippet to correctly encode your D-ID API key:

```bash
# Set your D-ID credentials
DID_RAW="api_username:api_password"
DID_BASIC=$(printf '%s' "$DID_RAW" | base64)

# Set the secret and deploy
supabase secrets set D_ID_API_KEY="Basic $DID_BASIC"
supabase functions deploy kataru --no-verify-jwt
```

### 8. Run the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

---

### Troubleshooting Note: D_ID_API_KEY Format
If you encounter authorization errors with the D-ID API, double-check your `D_ID_API_KEY`. It **must** be prefixed with `Basic ` followed by the base64-encoded credentials.

You can generate the base64 string using:
```bash
echo -n "api_username:api_password" | base64
```
Ensure there are no leading or trailing spaces in the environment variable.
