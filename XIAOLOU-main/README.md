<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/97293851-0444-4c89-9b7c-dd036ffd131d

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set `VITE_CORE_API_BASE_URL` in `.env.local` if your backend is not `http://127.0.0.1:4100`
3. Put `DASHSCOPE_API_KEY` in `../core-api/.env.local` for live model calls
4. Run the backend:
   `cd ../core-api && npm run dev`
5. Run the app:
   `npm run dev`
