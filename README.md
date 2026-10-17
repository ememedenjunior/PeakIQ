PeakIQ
Self-paced learning platform with live classes. Node/Express + MongoDB API, React (Vite) client, Paystack payments,
Socket.IO real-time channel, WebRTC live classes, offline access to paid courses.
Quick start (development)
Requirements: Node 20+, MongoDB running locally (or an Atlas URI).
```bash
# API
cd server
cp .env.example .env                       # set JWT_SECRET (any value in dev)
npm install
npm run seed                               # demo courses + an instructor account (password is printed)
npm run dev                                # http://localhost:5000

# Client (new terminal)
cd client
npm install
npm run dev                                # http://localhost:5173, proxies /api and /socket.io to :5000
```
Becoming an instructor. Everyone registers as a student. Promote an account with:
```bash
cd server && npm run role -- simplyemem10@gmail.com instructor      # or: student | admin
```
Instructors get an Instructor link in the navbar (course builder, task grading, live classes).
Live classes
An instructor opens Instructor → Go live on any of their courses (or the button in the course builder).
Only students enrolled in that course can join. This is enforced on the server twice, independently: when the
page loads (`GET /api/live/:id`) and when the socket joins the room (`live:join`). The instructor who started the
class and admins are the only exceptions. Everyone else is refused, whatever the client sends.
Enrolled students get a notification, a live toast, a "Live now" navbar pill and a banner on their dashboard and on the course page.
The instructor shares camera, microphone and screen (screen share is tuned for legible code), can switch chat on/off,
see who is watching, see raised hands, remove a student (they cannot rejoin), and end the class.
Students watch, chat and raise a hand. Students cannot broadcast anything.
One live class per course (database-enforced). One connection per person: a second tab replaces the first.
If the instructor's connection drops (refresh, Wi-Fi), the class stays open for `LIVE_HOST_GRACE_SECONDS` (90 s) and
students reconnect automatically. If the instructor does not return, it ends itself. A hard cap (`LIVE_MAX_HOURS`) stops forgotten sessions.
Attendance (who joined, total minutes) is recorded and shown to the instructor after the class.
How it works, and its limit
Media goes peer-to-peer from the instructor to each student (WebRTC), signalled over the authenticated Socket.IO
connection. That needs no media server, but the instructor uploads one stream per student, so class size is bounded by the
instructor's upload bandwidth. `LIVE_MAX_VIEWERS` (default 30) caps it. For larger classes, put an SFU
(LiveKit, mediasoup, Janus) behind the same access rules; `liveHub.js` is where the enrolment decision lives.
TURN server (required for real-world reliability)
STUN alone lets most home users connect, but students on campus, corporate or mobile-carrier networks often cannot receive
video without a TURN relay. Run coturn and set, in `.env`:
```
TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
TURN_SECRET=<same value as static-auth-secret below>
```
Minimal `turnserver.conf`:
```
use-auth-secret
static-auth-secret=<long random string>
realm=turn.example.com
fingerprint
no-multicast-peers
```
With `TURN_SECRET` the API issues short-lived per-user credentials (default 6 h) so the relay cannot be borrowed by
anyone who copies them from a page. Browsers only allow camera/microphone on HTTPS (or `localhost`).
Production deployment
The simplest setup is one container that serves the API and the built client on one domain (no CORS):
```bash
cp server/.env.example .env      # set NODE_ENV, MONGODB_URI, JWT_SECRET (32+ chars), CLIENT_URL, PAYSTACK_SECRET_KEY, TURN_*
docker compose up -d --build
```
Put it behind a TLS-terminating reverse proxy (nginx, Caddy, your platform's router) that forwards WebSocket upgrades
for `/socket.io`, and set `TRUST_PROXY=1`. The server refuses to start in production with a weak `JWT_SECRET` or a missing
`MONGODB_URI`/`CLIENT_URL`.
Health probes: `GET /api/health` (alive) and `GET /api/ready` (database connected).
Without Docker: `cd client && npm ci && npm run build`, then `cd server && npm ci --omit=dev && NODE_ENV=production npm start`.
To host the client elsewhere, build it with `VITE_API_URL=https://api.example.com`, set `SERVE_CLIENT=false` and
`CORS_ORIGINS=https://your-site.example`.
Run a single API instance. Live-class presence and rate-limit counters live in process memory. To scale out you need
sticky sessions plus the Socket.IO Redis adapter and a shared rate-limit store.
Security measures
JWT pinned to HS256, secret strength enforced in production, expired sessions sign the user out cleanly.
Passwords: bcrypt (cost 12), 8–72 characters, constant-time login (no account-existence timing leak), role can never be set at registration.
Rate limiting: global, plus strict limits on login (failed attempts), registration, payments, quizzes, live-class starts, and per-socket limits on chat, hands and signalling.
NoSQL-operator and prototype-pollution stripping on every request; strict input validation; capped body sizes (100 KB, 5 MB for course saves).
Ownership checks: instructors can only touch their own courses and submissions; other people's courses look like they do not exist.
Payments: price from the database only, charged amount and currency verified, webhook HMAC verified in constant time, fulfilment idempotent and self-healing.
Quiz answer keys are stored apart from courses and never sent to learners; grading is server-side; lesson completion enforces the test and required task on the server.
Helmet with a strict Content-Security-Policy, HSTS, `Permissions-Policy` (camera/mic only for this site), no framing. The code playground (`/terminal`) is the one page with a relaxed policy, because it runs learners' own code (still sandboxed). Set `CSP_REPORT_ONLY=true` to trial the policy without blocking anything.
Socket authentication on connect, 64 KB message cap, every live event authorised server-side.
Errors: server faults return a generic message; details are logged only.
Known trade-off: the login token is kept in `localStorage` (so it also authenticates the socket and works offline). The strict CSP and React's escaping are the mitigation; moving to httpOnly cookies would need CSRF protection.
Performance measures
Catalog and dashboard queries never load lesson bodies (aggregation / projection), and the public catalog is cacheable for 30 s.
Response compression (gzip), long-lived immutable caching for hashed assets, `no-cache` for HTML and the service worker.
Client code-splitting: the playground, course builder and live page load on demand; React, Markdown and Socket.IO ship as separate cacheable chunks.
Database indexes on every hot lookup; bulk notification writes for live-class announcements.
Service worker (it was missing before) caches the app shell and static assets for offline use; API calls are never cached.
Bandwidth caps per student connection and screen-share tuning for live classes.
Course workflow
Every lesson needs a test before a course can be published (`REQUIRE_LESSON_QUIZ=true`). Seeded demo courses have no
tests, so to edit one either add a test to each lesson or run with `REQUIRE_LESSON_QUIZ=false`. Re-running the seed keeps
existing courses (it would otherwise regenerate lesson IDs and orphan learners' progress); `SEED_FORCE=1` overrides.
Paystack
Put your secret key in `.env` (`PAYSTACK_SECRET_KEY`). Free courses (price 0) enrol instantly without it.
Set the Paystack webhook to `https://<your-domain>/api/payments/webhook`.
The callback URL is `CLIENT_URL/payment/callback` and is sent per transaction.
API overview
Method	Path	Notes
POST	/api/auth/register, /login; GET /me	JWT
GET	/api/courses, /api/courses/:slug	Public catalog / outline (`enrolled` flag when signed in)
GET	/api/courses/:id/content, /offline	Enrolled students (and the course's instructor for preview)
GET/POST	/api/learning/...	Dashboard, lesson test, practical task, progress
GET/POST/PUT/PATCH/DELETE	/api/instructor/...	Course builder, publishing, grading (instructors)
GET	/api/live/active	Live classes in my courses
POST	/api/live/courses/:id/start	Start a class (course owner)
GET	/api/live/:id	Session + ICE servers (enrolled students, host, admin)
POST	/api/live/:id/end; GET /:id/attendance	Host only
POST/GET	/api/payments/initialize, /verify/:ref, /webhook	Paystack / free enrolment
GET/POST	/api/notifications	List, mark read
Socket events (`live:*`): `join`, `signal`, `request-offer`, `chat`, `hand`, `chat-toggle`, `kick`, `lower-hand`, `leave`.
Tests
```bash
cd server && npm test      # 26 tests: live authorization, signalling validation, TURN credentials, sanitiser, course rules
```
Not included (worth adding next)
Email verification and password reset, an SFU for large live classes, recording live classes, an admin UI for managing roles, a CDN for lesson video.