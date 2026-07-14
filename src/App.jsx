import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import AdminRoute from '@/components/AdminRoute';
import { BackgroundProvider } from '@/lib/BackgroundContext';
import BuildSheet from './pages/BuildSheet';
import { ShortcutProvider } from '@/lib/ShortcutContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { ThemeProvider } from '@/lib/ThemeContext';
import { VertexChatProvider, useVertexChat } from '@/lib/VertexChatContext';
import VertexChat from '@/components/VertexChat';
import EntityChat from '@/components/EntityChat';
import FloatingVertexButton from '@/components/FloatingVertexButton';
import FloatingRoomsButton from '@/components/FloatingRoomsButton';
import FloatingSettingsButton from '@/components/FloatingSettingsButton';
import ScreenTracker from '@/components/ScreenTracker';
import JarvisInterrupt from '@/components/JarvisInterrupt';
import ErrorBoundary from '@/components/ErrorBoundary';
import GlobalErrorReporter from '@/components/GlobalErrorReporter';
import WorkOrderPage from './pages/WorkOrderPage';
import Builds from './pages/Builds';
import BuildDetail from './pages/BuildDetail';
import BuildParts from './pages/BuildParts';
import BuildPartsLibrary from './pages/BuildPartsLibrary';
import MeetingNotes from './pages/MeetingNotes';
import Contacts from './pages/Contacts';
import Home from './pages/Home';
import PartsLibrary from './pages/PartsLibrary';
import MasterSheet from './pages/MasterSheet';
import Inventory from './pages/Inventory';
import Stock from './pages/Stock';
import StockLocation from './pages/StockLocation.jsx';
import GeminiScanner from './pages/GeminiScanner';
import InventoryIdeas from './pages/InventoryIdeas';
import BuildWorkOrder from './pages/BuildWorkOrder.jsx';
import Profile from './pages/Profile.jsx';
import MyProfile from './pages/MyProfile.jsx';
import TeamProfiles from './pages/TeamProfiles.jsx';
import Vertex from './pages/Vertex.jsx';
import BuildPhases from './pages/BuildPhases.jsx';
import PhaseDetail from './pages/PhaseDetail.jsx';
import AIRoom from './pages/AIRoom.jsx';
import RoomsView from './pages/RoomsView.jsx';
import MusicApp from './pages/MusicApp.jsx';
import Modulation from './pages/Modulation.jsx';
import Settings from './pages/Settings.jsx';
import Bugs from './pages/Bugs.jsx';
import Login from './pages/Login.jsx';

import { useEffect } from 'react';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

// Auto-registered pages that are admin-only (members are redirected home).
const ADMIN_ONLY_PAGES = new Set(['SOPList', 'SOPView', 'SOPEditor']);

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated } = useAuth();
  const isLoginPage = window.location.pathname === '/Login';

  // Show spinner while checking auth
  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black">
        <div className="w-8 h-8 border-4 border-zinc-700 border-t-white rounded-full animate-spin"></div>
      </div>
    );
  }

  // If not authenticated and not already on login page, redirect
  if (!isAuthenticated && !isLoginPage) {
    window.location.href = '/Login';
    return null;
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => {
        const page = <Page />;
        return (
          <Route
            key={path}
            path={`/${path}`}
            element={
              <LayoutWrapper currentPageName={path}>
                {ADMIN_ONLY_PAGES.has(path) ? <AdminRoute>{page}</AdminRoute> : page}
              </LayoutWrapper>
            }
          />
        );
      })}
      <Route path="/WorkOrderPage" element={<WorkOrderPage />} />
      <Route path="/Home" element={<Home />} />
      <Route path="/PartsLibrary" element={<PartsLibrary />} />
      <Route path="/MasterSheet" element={<MasterSheet />} />
      <Route path="/Builds" element={<AdminRoute><Builds /></AdminRoute>} />
      <Route path="/BuildDetail" element={<AdminRoute><BuildDetail /></AdminRoute>} />
      <Route path="/BuildParts" element={<AdminRoute><BuildParts /></AdminRoute>} />
      <Route path="/BuildPartsLibrary" element={<AdminRoute><BuildPartsLibrary /></AdminRoute>} />
      <Route path="/MeetingNotes" element={<MeetingNotes />} />
      <Route path="/Inventory" element={<Inventory />} />
      <Route path="/Stock" element={<Stock />} />
      <Route path="/StockLocation" element={<StockLocation />} />
      <Route path="/GeminiScanner" element={<GeminiScanner />} />
      <Route path="/InventoryIdeas" element={<InventoryIdeas />} />
      <Route path="/BuildSheet" element={<AdminRoute><BuildSheet /></AdminRoute>} />
      <Route path="/Contacts" element={<AdminRoute><Contacts /></AdminRoute>} />
      <Route path="/BuildWorkOrder" element={<AdminRoute><BuildWorkOrder /></AdminRoute>} />
      <Route path="/Profile" element={<Profile />} />
      <Route path="/MyProfile" element={<MyProfile />} />
      <Route path="/TeamProfiles" element={<TeamProfiles />} />
      <Route path="/Vertex" element={<AdminRoute><Vertex /></AdminRoute>} />
      <Route path="/BuildPhases" element={<AdminRoute><BuildPhases /></AdminRoute>} />
      <Route path="/PhaseDetail" element={<AdminRoute><PhaseDetail /></AdminRoute>} />
      <Route path="/AIRoom" element={<AdminRoute><AIRoom /></AdminRoute>} />
      <Route path="/Rooms" element={<AdminRoute><RoomsView /></AdminRoute>} />
      <Route path="/MusicApp" element={<AdminRoute><MusicApp /></AdminRoute>} />
      <Route path="/Modulation" element={<AdminRoute><Modulation /></AdminRoute>} />
      <Route path="/Settings" element={<AdminRoute><Settings /></AdminRoute>} />
      <Route path="/Bugs" element={<AdminRoute><Bugs /></AdminRoute>} />
      <Route path="/Login" element={<Login />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function GlobalVertexChat() {
  const { isOpen, close, entityMode } = useVertexChat();
  if (entityMode) return <EntityChat isOpen={isOpen} onClose={close} />;
  return <VertexChat isOpen={isOpen} onClose={close} />;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <BackgroundProvider>
        <VertexChatProvider>
          <AuthProvider>
            <ShortcutProvider>
              <QueryClientProvider client={queryClientInstance}>
                <Router>
                  <NavigationTracker />
                  <ScreenTracker />
                  <AuthenticatedApp />
                  <FloatingVertexButton />
                  <FloatingRoomsButton />
                  <FloatingSettingsButton />
                  <GlobalVertexChat />
                  <JarvisInterrupt />
                </Router>
                <Toaster />
                <GlobalErrorReporter />
              </QueryClientProvider>
            </ShortcutProvider>
          </AuthProvider>
        </VertexChatProvider>
        </BackgroundProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App