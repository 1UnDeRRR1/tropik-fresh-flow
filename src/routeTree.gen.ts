/* eslint-disable */
// @ts-nocheck

import { Route as rootRouteImport } from './routes/__root'
import { Route as IndexRouteImport } from './routes/index'
import { Route as LoginRouteImport } from './routes/login'
import { Route as AuthLayoutRouteImport } from './routes/_authenticated'
import { Route as AuthIndexRouteImport } from './routes/_authenticated/index'
import { Route as DashManagerRouteImport } from './routes/_authenticated/dashboard/manager'
import { Route as DashBranchRouteImport } from './routes/_authenticated/dashboard/branch'
import { Route as DashAdminRouteImport } from './routes/_authenticated/dashboard/admin'
import { Route as DashSuperAdminRouteImport } from './routes/_authenticated/dashboard/super-admin'
import { Route as ShipmentsIndexImport } from './routes/_authenticated/shipments/index'
import { Route as ShipmentsNewImport } from './routes/_authenticated/shipments/new'
import { Route as ShipmentsIdImport } from './routes/_authenticated/shipments/$id'
import { Route as DistributionImport } from './routes/_authenticated/distribution'
import { Route as SuppliersImport } from './routes/_authenticated/suppliers'
import { Route as TransfersImport } from './routes/_authenticated/transfers'
import { Route as AnalyticsImport } from './routes/_authenticated/analytics'
import { Route as NotificationsImport } from './routes/_authenticated/notifications'
import { Route as SettingsImport } from './routes/_authenticated/settings'
import { Route as CostsImport } from './routes/_authenticated/costs'

const IndexRoute = IndexRouteImport.update({ id: '/', path: '/', getParentRoute: () => rootRouteImport } as any)
const LoginRoute = LoginRouteImport.update({ id: '/login', path: '/login', getParentRoute: () => rootRouteImport } as any)
const AuthLayoutRoute = AuthLayoutRouteImport.update({ id: '/_authenticated', getParentRoute: () => rootRouteImport } as any)
const AuthIndexRoute = AuthIndexRouteImport.update({ id: '/', path: '/', getParentRoute: () => AuthLayoutRoute } as any)
const DashManagerRoute = DashManagerRouteImport.update({ id: '/dashboard/manager', path: '/dashboard/manager', getParentRoute: () => AuthLayoutRoute } as any)
const DashBranchRoute = DashBranchRouteImport.update({ id: '/dashboard/branch', path: '/dashboard/branch', getParentRoute: () => AuthLayoutRoute } as any)
const DashAdminRoute = DashAdminRouteImport.update({ id: '/dashboard/admin', path: '/dashboard/admin', getParentRoute: () => AuthLayoutRoute } as any)
const DashSuperAdminRoute = DashSuperAdminRouteImport.update({ id: '/dashboard/super-admin', path: '/dashboard/super-admin', getParentRoute: () => AuthLayoutRoute } as any)
const ShipmentsIndexRoute = ShipmentsIndexImport.update({ id: '/shipments/', path: '/shipments/', getParentRoute: () => AuthLayoutRoute } as any)
const ShipmentsNewRoute = ShipmentsNewImport.update({ id: '/shipments/new', path: '/shipments/new', getParentRoute: () => AuthLayoutRoute } as any)
const ShipmentsIdRoute = ShipmentsIdImport.update({ id: '/shipments/$id', path: '/shipments/$id', getParentRoute: () => AuthLayoutRoute } as any)
const DistributionRoute = DistributionImport.update({ id: '/distribution', path: '/distribution', getParentRoute: () => AuthLayoutRoute } as any)
const SuppliersRoute = SuppliersImport.update({ id: '/suppliers', path: '/suppliers', getParentRoute: () => AuthLayoutRoute } as any)
const TransfersRoute = TransfersImport.update({ id: '/transfers', path: '/transfers', getParentRoute: () => AuthLayoutRoute } as any)
const AnalyticsRoute = AnalyticsImport.update({ id: '/analytics', path: '/analytics', getParentRoute: () => AuthLayoutRoute } as any)
const NotificationsRoute = NotificationsImport.update({ id: '/notifications', path: '/notifications', getParentRoute: () => AuthLayoutRoute } as any)
const SettingsRoute = SettingsImport.update({ id: '/settings', path: '/settings', getParentRoute: () => AuthLayoutRoute } as any)
const CostsRoute = CostsImport.update({ id: '/costs', path: '/costs', getParentRoute: () => AuthLayoutRoute } as any)

export interface FileRoutesByFullPath {
  '/': typeof AuthIndexRoute
  '/login': typeof LoginRoute
  '/dashboard/manager': typeof DashManagerRoute
  '/dashboard/branch': typeof DashBranchRoute
  '/dashboard/admin': typeof DashAdminRoute
  '/dashboard/super-admin': typeof DashSuperAdminRoute
  '/shipments': typeof ShipmentsIndexRoute
  '/shipments/new': typeof ShipmentsNewRoute
  '/shipments/$id': typeof ShipmentsIdRoute
  '/distribution': typeof DistributionRoute
  '/suppliers': typeof SuppliersRoute
  '/transfers': typeof TransfersRoute
  '/analytics': typeof AnalyticsRoute
  '/notifications': typeof NotificationsRoute
  '/settings': typeof SettingsRoute
  '/costs': typeof CostsRoute
}
export interface FileRoutesByTo extends FileRoutesByFullPath {}
export interface FileRoutesById {
  __root__: typeof rootRouteImport
  '/': typeof IndexRoute
  '/login': typeof LoginRoute
  '/_authenticated': typeof AuthLayoutRouteWithChildren
  '/_authenticated/': typeof AuthIndexRoute
  '/_authenticated/dashboard/manager': typeof DashManagerRoute
  '/_authenticated/dashboard/branch': typeof DashBranchRoute
  '/_authenticated/dashboard/admin': typeof DashAdminRoute
  '/_authenticated/dashboard/super-admin': typeof DashSuperAdminRoute
  '/_authenticated/shipments/': typeof ShipmentsIndexRoute
  '/_authenticated/shipments/new': typeof ShipmentsNewRoute
  '/_authenticated/shipments/$id': typeof ShipmentsIdRoute
  '/_authenticated/distribution': typeof DistributionRoute
  '/_authenticated/suppliers': typeof SuppliersRoute
  '/_authenticated/transfers': typeof TransfersRoute
  '/_authenticated/analytics': typeof AnalyticsRoute
  '/_authenticated/notifications': typeof NotificationsRoute
  '/_authenticated/settings': typeof SettingsRoute
  '/_authenticated/costs': typeof CostsRoute
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: keyof FileRoutesByFullPath
  fileRoutesByTo: FileRoutesByTo
  to: keyof FileRoutesByTo
  id: keyof FileRoutesById
  fileRoutesById: FileRoutesById
}

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/': { id: '/'; path: '/'; fullPath: '/'; preLoaderRoute: typeof IndexRouteImport; parentRoute: typeof rootRouteImport }
    '/login': { id: '/login'; path: '/login'; fullPath: '/login'; preLoaderRoute: typeof LoginRouteImport; parentRoute: typeof rootRouteImport }
    '/_authenticated': { id: '/_authenticated'; path: ''; fullPath: ''; preLoaderRoute: typeof AuthLayoutRouteImport; parentRoute: typeof rootRouteImport }
    '/_authenticated/': { id: '/_authenticated/'; path: '/'; fullPath: '/'; preLoaderRoute: typeof AuthIndexRouteImport; parentRoute: typeof AuthLayoutRoute }
    '/_authenticated/dashboard/manager': { id: '/_authenticated/dashboard/manager'; path: '/dashboard/manager'; fullPath: '/dashboard/manager'; preLoaderRoute: typeof DashManagerRouteImport; parentRoute: typeof AuthLayoutRoute }
    '/_authenticated/dashboard/branch': { id: '/_authenticated/dashboard/branch'; path: '/dashboard/branch'; fullPath: '/dashboard/branch'; preLoaderRoute: typeof DashBranchRouteImport; parentRoute: typeof AuthLayoutRoute }
    '/_authenticated/dashboard/admin': { id: '/_authenticated/dashboard/admin'; path: '/dashboard/admin'; fullPath: '/dashboard/admin'; preLoaderRoute: typeof DashAdminRouteImport; parentRoute: typeof AuthLayoutRoute }
    '/_authenticated/dashboard/super-admin': { id: '/_authenticated/dashboard/super-admin'; path: '/dashboard/super-admin'; fullPath: '/dashboard/super-admin'; preLoaderRoute: typeof DashSuperAdminRouteImport; parentRoute: typeof AuthLayoutRoute }
    '/_authenticated/shipments/': { id: '/_authenticated/shipments/'; path: '/shipments'; fullPath: '/shipments'; preLoaderRoute: typeof ShipmentsIndexImport; parentRoute: typeof AuthLayoutRoute }
    '/_authenticated/shipments/new': { id: '/_authenticated/shipments/new'; path: '/shipments/new'; fullPath: '/shipments/new'; preLoaderRoute: typeof ShipmentsNewImport; parentRoute: typeof AuthLayoutRoute }
    '/_authenticated/shipments/$id': { id: '/_authenticated/shipments/$id'; path: '/shipments/$id'; fullPath: '/shipments/$id'; preLoaderRoute: typeof ShipmentsIdImport; parentRoute: typeof AuthLayoutRoute }
    '/_authenticated/distribution': { id: '/_authenticated/distribution'; path: '/distribution'; fullPath: '/distribution'; preLoaderRoute: typeof DistributionImport; parentRoute: typeof AuthLayoutRoute }
    '/_authenticated/suppliers': { id: '/_authenticated/suppliers'; path: '/suppliers'; fullPath: '/suppliers'; preLoaderRoute: typeof SuppliersImport; parentRoute: typeof AuthLayoutRoute }
    '/_authenticated/transfers': { id: '/_authenticated/transfers'; path: '/transfers'; fullPath: '/transfers'; preLoaderRoute: typeof TransfersImport; parentRoute: typeof AuthLayoutRoute }
    '/_authenticated/analytics': { id: '/_authenticated/analytics'; path: '/analytics'; fullPath: '/analytics'; preLoaderRoute: typeof AnalyticsImport; parentRoute: typeof AuthLayoutRoute }
    '/_authenticated/notifications': { id: '/_authenticated/notifications'; path: '/notifications'; fullPath: '/notifications'; preLoaderRoute: typeof NotificationsImport; parentRoute: typeof AuthLayoutRoute }
    '/_authenticated/settings': { id: '/_authenticated/settings'; path: '/settings'; fullPath: '/settings'; preLoaderRoute: typeof SettingsImport; parentRoute: typeof AuthLayoutRoute }
    '/_authenticated/costs': { id: '/_authenticated/costs'; path: '/costs'; fullPath: '/costs'; preLoaderRoute: typeof CostsImport; parentRoute: typeof AuthLayoutRoute }
  }
}

interface AuthLayoutRouteChildren {
  AuthIndexRoute: typeof AuthIndexRoute
  DashManagerRoute: typeof DashManagerRoute
  DashBranchRoute: typeof DashBranchRoute
  DashAdminRoute: typeof DashAdminRoute
  DashSuperAdminRoute: typeof DashSuperAdminRoute
  ShipmentsIndexRoute: typeof ShipmentsIndexRoute
  ShipmentsNewRoute: typeof ShipmentsNewRoute
  ShipmentsIdRoute: typeof ShipmentsIdRoute
  DistributionRoute: typeof DistributionRoute
  SuppliersRoute: typeof SuppliersRoute
  TransfersRoute: typeof TransfersRoute
  AnalyticsRoute: typeof AnalyticsRoute
  NotificationsRoute: typeof NotificationsRoute
  SettingsRoute: typeof SettingsRoute
  CostsRoute: typeof CostsRoute
}
const AuthLayoutRouteChildren: AuthLayoutRouteChildren = {
  AuthIndexRoute, DashManagerRoute, DashBranchRoute, DashAdminRoute, DashSuperAdminRoute,
  ShipmentsIndexRoute, ShipmentsNewRoute, ShipmentsIdRoute, DistributionRoute,
  SuppliersRoute, TransfersRoute, AnalyticsRoute, NotificationsRoute, SettingsRoute, CostsRoute,
}
const AuthLayoutRouteWithChildren = AuthLayoutRoute._addFileChildren(AuthLayoutRouteChildren)

export interface RootRouteChildren {
  IndexRoute: typeof IndexRoute
  LoginRoute: typeof LoginRoute
  AuthLayoutRoute: typeof AuthLayoutRouteWithChildren
}
const rootRouteChildren: RootRouteChildren = {
  IndexRoute, LoginRoute, AuthLayoutRoute: AuthLayoutRouteWithChildren,
}
export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>()
