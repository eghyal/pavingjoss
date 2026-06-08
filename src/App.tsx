/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { MotionConfig, AnimatePresence, motion } from 'motion/react';
import Layout from '@/components/layouts/Layout';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { Loader } from '@/components/shared/Loader';
import { AuthProvider, useAuth, Role } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ShareProvider } from './contexts/ShareContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { AttendanceReminder } from '@/components/shared/AttendanceReminder';

// Lazy load pages
const Overview = lazy(() => import('./pages/erp/Overview'));
const Quotations = lazy(() => import('./pages/erp/Quotations'));
const DataCenter = lazy(() => import('./pages/erp/DataCenter'));
const Production = lazy(() => import('./pages/erp/Production'));
const Procurement = lazy(() => import('./pages/erp/Procurement'));
const Engineering = lazy(() => import('./pages/erp/Engineering'));
const Requests = lazy(() => import('./pages/erp/Requests'));
const ProjectDetails = lazy(() => import('./pages/erp/ProjectDetails'));
const Customers = lazy(() => import('./pages/erp/Customers'));
const Deliveries = lazy(() => import('./pages/erp/Deliveries'));
const Pricing = lazy(() => import('./pages/erp/Pricing'));
const Warehouse = lazy(() => import('./pages/erp/Warehouse'));
const Vendors = lazy(() => import('./pages/erp/Vendors'));
const Logs = lazy(() => import('./pages/erp/Logs'));
const Login = lazy(() => import('./pages/auth/Login'));
const Forum = lazy(() => import('./pages/erp/Forum'));
const ManageAccounts = lazy(() => import('./pages/erp/ManageAccounts'));
const Workflow = lazy(() => import('./pages/erp/Workflow'));
const Invoices = lazy(() => import('./pages/erp/Invoices'));
const Payables = lazy(() => import('./pages/erp/Payables'));
const Payroll = lazy(() => import('./pages/erp/Payroll'));
const Finance = lazy(() => import('./pages/erp/Finance'));
const ImportData = lazy(() => import('./pages/erp/ImportData'));
const HumanResource = lazy(() => import('./pages/hris/HumanResource'));
const EmployeeSelfService = lazy(() => import('./pages/hris/EmployeeSelfService'));
const PublicHome = lazy(() => import('./pages/public/PublicHome'));
const Careers = lazy(() => import('./pages/public/Careers'));
const HrLogin = lazy(() => import('./pages/auth/HrLogin'));

import HrLayout from '@/components/layouts/HrLayout';
import { Action, hasGodMode, hasPermission } from './utils/pbac';

function ProtectedRoute({ children, requiredAction, fcOnly }: { children: React.ReactNode, requiredAction?: Action, fcOnly?: boolean }) {
  const { user } = useAuth();
  
  if (!user) return <Navigate to="/login" replace />;
  
  if (hasGodMode(user)) return <>{children}</>;

  if (fcOnly) {
    if (!hasGodMode(user)) {
      return <Navigate to="/erp" replace />;
    }
  }

  if (requiredAction) {
    if (!hasPermission(user, requiredAction)) {
      return <Navigate to="/erp" replace />;
    }
  }
  
  return <>{children}</>;
}

function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="w-full"
    >
      {children}
    </motion.div>
  );
}

function AnimatedRoutes() {
  const location = useLocation();
  const { user } = useAuth();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        {/* Unauthenticated / Public Routes */}
        <Route path="/" element={<Suspense fallback={<Loader fullScreen text="Loading..." />}><PageWrapper><PublicHome /></PageWrapper></Suspense>} />
        <Route path="/careers" element={<Suspense fallback={<Loader fullScreen text="Loading..." />}><PageWrapper><Careers /></PageWrapper></Suspense>} />
        <Route path="/login" element={
          user ? (
            <Navigate to={user.role === 'HR' ? "/hr" : "/erp"} replace />
          ) : (
            <Suspense fallback={<Loader fullScreen text="Loading Session..." />}><PageWrapper><Login /></PageWrapper></Suspense>
          )
        } />
        <Route path="/hr-login" element={
          user ? (
            <Navigate to="/hr" replace />
          ) : (
            <Suspense fallback={<Loader fullScreen text="Loading HR Session..." />}><PageWrapper><HrLogin /></PageWrapper></Suspense>
          )
        } />

        {/* Standalone Protected HR Portal */}
        <Route path="/hr/*" element={
          !user ? (
            <Navigate to="/hr-login" replace />
          ) : (user.role !== 'HR' && user.role !== 'FC') ? (
            <Navigate to="/erp" replace />
          ) : (
            <HrLayout>
              <ErrorBoundary>
                <Suspense fallback={<Loader text="Loading HR Portal..." />}>
                  <PageWrapper>
                    <HumanResource />
                  </PageWrapper>
                </Suspense>
              </ErrorBoundary>
            </HrLayout>
          )
        } />

        {/* Protected ERP Paths */}
        <Route path="/*" element={
          !user ? (
            <Navigate to="/login" replace />
          ) : (
            <Layout>
              <ErrorBoundary>
                <Suspense fallback={<Loader text="Loading Module..." />}>
                  <Routes>
                    <Route path="/erp" element={<PageWrapper><Overview /></PageWrapper>} />
                    <Route path="/ess" element={<PageWrapper><EmployeeSelfService /></PageWrapper>} />
                    <Route path="/quotations" element={<ProtectedRoute requiredAction={Action.VIEW_QUOTATIONS}><PageWrapper><Quotations /></PageWrapper></ProtectedRoute>} />
                    <Route path="/data-center" element={<ProtectedRoute requiredAction={Action.VIEW_MASTER_DATA}><PageWrapper><DataCenter /></PageWrapper></ProtectedRoute>} />
                    <Route path="/import" element={<ProtectedRoute requiredAction={Action.VIEW_MASTER_DATA}><PageWrapper><ImportData /></PageWrapper></ProtectedRoute>} />
                    <Route path="/production" element={<ProtectedRoute requiredAction={Action.VIEW_PRODUCTION}><PageWrapper><Production /></PageWrapper></ProtectedRoute>} />
                    <Route path="/project/:id" element={<PageWrapper><ProjectDetails /></PageWrapper>} />
                    <Route path="/procurement" element={<ProtectedRoute requiredAction={Action.VIEW_PROCUREMENT}><PageWrapper><Procurement /></PageWrapper></ProtectedRoute>} />
                    <Route path="/engineering" element={<ProtectedRoute requiredAction={Action.VIEW_BOM}><PageWrapper><Engineering /></PageWrapper></ProtectedRoute>} />
                    <Route path="/requests" element={<ProtectedRoute requiredAction={Action.VIEW_DESIGN_REQUESTS}><PageWrapper><Requests /></PageWrapper></ProtectedRoute>} />
                    <Route path="/pricing" element={<ProtectedRoute requiredAction={Action.VIEW_PRICING}><PageWrapper><Pricing /></PageWrapper></ProtectedRoute>} />
                    <Route path="/warehouse" element={<ProtectedRoute requiredAction={Action.VIEW_WAREHOUSE}><PageWrapper><Warehouse /></PageWrapper></ProtectedRoute>} />
                    <Route path="/customers" element={<ProtectedRoute requiredAction={Action.VIEW_CUSTOMERS}><PageWrapper><Customers /></PageWrapper></ProtectedRoute>} />
                    <Route path="/deliveries" element={<ProtectedRoute requiredAction={Action.VIEW_DELIVERIES}><PageWrapper><Deliveries /></PageWrapper></ProtectedRoute>} />
                    <Route path="/invoices" element={<ProtectedRoute requiredAction={Action.VIEW_INVOICES}><PageWrapper><Invoices /></PageWrapper></ProtectedRoute>} />
                    <Route path="/payables" element={<ProtectedRoute requiredAction={Action.VIEW_FINANCE}><PageWrapper><Payables /></PageWrapper></ProtectedRoute>} />
                    <Route path="/payroll" element={<ProtectedRoute requiredAction={Action.VIEW_FINANCE}><PageWrapper><Payroll /></PageWrapper></ProtectedRoute>} />
                    <Route path="/finance" element={<ProtectedRoute requiredAction={Action.VIEW_FINANCE}><PageWrapper><Finance /></PageWrapper></ProtectedRoute>} />
                    <Route path="/vendors" element={<ProtectedRoute requiredAction={Action.VIEW_VENDORS}><PageWrapper><Vendors /></PageWrapper></ProtectedRoute>} />
                    <Route path="/forum" element={<PageWrapper><Forum /></PageWrapper>} />
                    <Route path="/logs" element={<ProtectedRoute fcOnly><PageWrapper><Logs /></PageWrapper></ProtectedRoute>} />
                    <Route path="/workflow" element={<ProtectedRoute requiredAction={Action.MANAGE_ACCOUNTS}><PageWrapper><Workflow /></PageWrapper></ProtectedRoute>} />
                    <Route path="/manage-accounts" element={<ProtectedRoute requiredAction={Action.MANAGE_ACCOUNTS}><PageWrapper><ManageAccounts /></PageWrapper></ProtectedRoute>} />
                    <Route path="*" element={<Navigate to="/erp" replace />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </Layout>
          )
        } />
      </Routes>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <LanguageProvider>
        <NotificationProvider>
          <ToastProvider>
            <ShareProvider>
              <MotionConfig reducedMotion="user">
                <BrowserRouter>
                  <AnimatedRoutes />
                  <AttendanceReminder />
                </BrowserRouter>
              </MotionConfig>
            </ShareProvider>
          </ToastProvider>
        </NotificationProvider>
      </LanguageProvider>
    </AuthProvider>
  );
}
