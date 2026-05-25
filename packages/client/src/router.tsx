import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './state/authStore.js';
import { useSettingsStore } from './state/settingsStore.js';
import Login from './pages/Login.js';
import Chat from './pages/Chat.js';
import Settings from './pages/Settings.js';
import Stub from './pages/Stub.js';
import Usage from './pages/Usage.js';
import Memory from './pages/Memory.js';
import Facts from './pages/Facts.js';
import Import from './pages/Import.js';
import Knowledge from './pages/Knowledge.js';
import Wiki from './pages/Wiki.js';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();
  if (isLoading) return <div className="loading">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RedirectIfAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();
  if (isLoading) return <div className="loading">Loading...</div>;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function AppRouter() {
  const { fetchMe, user } = useAuthStore();
  const { loadSettings, loadProviders } = useSettingsStore();

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  useEffect(() => {
    if (!user?.id) return;
    loadSettings();
    loadProviders();
  }, [user?.id, loadSettings, loadProviders]);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <RedirectIfAuth>
              <Login />
            </RedirectIfAuth>
          }
        />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Chat />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <Settings />
            </RequireAuth>
          }
        />
        <Route
          path="/usage"
          element={
            <RequireAuth>
              <Usage />
            </RequireAuth>
          }
        />
        <Route
          path="/agents"
          element={
            <RequireAuth>
              <Stub title="Agent Files" />
            </RequireAuth>
          }
        />
        <Route
          path="/memory"
          element={
            <RequireAuth>
              <Memory />
            </RequireAuth>
          }
        />
        <Route
          path="/facts"
          element={
            <RequireAuth>
              <Facts />
            </RequireAuth>
          }
        />
        <Route
          path="/import"
          element={
            <RequireAuth>
              <Import />
            </RequireAuth>
          }
        />
        <Route
          path="/knowledge"
          element={
            <RequireAuth>
              <Knowledge />
            </RequireAuth>
          }
        />
        <Route
          path="/wiki"
          element={
            <RequireAuth>
              <Wiki />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
