import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { isStaff, useAuth } from './context/AuthContext.jsx';
import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';
import Toasts from './components/Toasts.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Home from './pages/Home.jsx';
import Courses from './pages/Courses.jsx';
import CourseDetail from './pages/CourseDetail.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Learn from './pages/Learn.jsx';
import PaymentCallback from './pages/PaymentCallback.jsx';
import Notifications from './pages/Notifications.jsx';

// Heavy or role-specific pages load on demand, which keeps the first page fast for everyone else.
const Playground = lazy(() => import('./pages/Terminal.jsx'));
const InstructorCourses = lazy(() => import('./pages/InstructorCourses.jsx'));
const CourseBuilder = lazy(() => import('./pages/CourseBuilder.jsx'));
const LiveSession = lazy(() => import('./pages/LiveSession.jsx'));

function Private({ children, staff = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="center muted">Loading…</p>;
  // Remember where they were headed (e.g. a live class link from a notification) so login returns them there
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (staff && !isStaff(user)) return <Navigate to="/dashboard" replace />;
  return children;
}

// The playground needs the relaxed security policy the server only applies to a fresh page load of /terminal.
// If the router got us here without one (it should not, the nav link reloads), reload once.
function PlaygroundRoute() {
  const served = document.querySelector('meta[name="piq-profile"][content="playground"]');
  if (!served && import.meta.env.PROD && !sessionStorage.getItem('piq-pg-reload')) {
    sessionStorage.setItem('piq-pg-reload', '1');
    window.location.reload();
    return null;
  }
  return <Playground />;
}

// These pages run edge to edge; everything else sits in the standard container
const FULL_WIDTH = ['/', '/login', '/register'];

export default function App() {
  const { pathname } = useLocation();
  const full = FULL_WIDTH.includes(pathname);
  const inLive = pathname.startsWith('/live/');

  return (
    <>
      <Navbar />
      <Toasts />
      <main className={full ? undefined : 'container'}>
        <ErrorBoundary>
          <Suspense fallback={<p className="center muted">Loading…</p>}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/courses" element={<Courses />} />
              <Route path="/terminal" element={<PlaygroundRoute />} />
              <Route path="/courses/:slug" element={<CourseDetail />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Login register />} />
              <Route path="/dashboard" element={<Private><Dashboard /></Private>} />
              <Route path="/instructor" element={<Private staff><InstructorCourses /></Private>} />
              <Route path="/instructor/courses/:id" element={<Private staff><CourseBuilder /></Private>} />
              <Route path="/learn/:courseId" element={<Private><Learn /></Private>} />
              <Route path="/live/:sessionId" element={<Private><LiveSession /></Private>} />
              <Route path="/payment/callback" element={<Private><PaymentCallback /></Private>} />
              <Route path="/notifications" element={<Private><Notifications /></Private>} />
              <Route path="*" element={<p className="center muted">Page not found.</p>} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      {pathname !== '/login' && pathname !== '/register' && !inLive && <Footer />}
    </>
  );
}
