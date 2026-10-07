# Afaan Social — V1

Starter social platform for GitHub + Render + Neon.

## Included
- Signup / login / logout
- Profile edit
- User + admin roles
- Admin-created account on first startup
- Posts enter `pending` status before public feed
- Admin approve/reject
- Comments
- Follow
- Friend request / confirm / reject
- Real-time chat via Socket.IO
- Online socket presence foundation
- Audio/video call signaling foundation
- VIP request + admin phone/username display
- Admin warning / suspend / ban / unban
- PostgreSQL persistence

## Important media note
Render web-service local disk is not a permanent media store. V1 therefore accepts a media URL rather than pretending uploaded video/audio is permanently stored. For real TikTok-style video/audio uploads and durable download, add an object-storage service (or a deliberately designed PostgreSQL bytea/blob strategy) in V2.

## Local
1. Copy `.env.example` to `.env`.
2. Put your Neon `DATABASE_URL` in `.env`.
3. Set a strong `SESSION_SECRET`.
4. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
5. Run `npm install`
6. Run `npm start`
7. Open `http://localhost:10000`

## Render
- Connect GitHub repository.
- Build command: `npm install`
- Start command: `npm start`
- Add `DATABASE_URL` from Neon in Render Environment.
- Add `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
- Render can redeploy automatically after pushes to the selected branch.

Never commit `.env` or database credentials.
