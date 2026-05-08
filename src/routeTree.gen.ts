/* eslint-disable */
// @ts-nocheck
// noinspection JSUnusedGlobalSymbols
// This file is generated. Do not edit manually unless the watcher is stuck.

import { Route as rootRouteImport } from './routes/__root'
import { Route as IndexRouteImport } from './routes/index'
import { Route as LoginRouteImport } from './routes/login'
import { Route as AuthLayoutRouteImport } from './routes/_authenticated'
import { Route as AuthIndexRouteImport } from './routes/_authenticated/index'
import { Route as DashManagerRouteImport } from './routes/_authenticated/dashboard/manager'
import { Route as DashBranchRouteImport } from './routes/_authenticated/dashboard/branch'
import { Route as DashAdminRouteImport } from './routes/_authenticated/dashboard/admin'
import { Route as DashSuperAdminRouteImport } from './routes/_authenticated/dashboard/super-admin'

const IndexRoute = IndexRouteImport.update({ id: '/', path: '/', getParentRoute: () => rootRouteImport } as any)
const LoginRoute = LoginRouteImport.update({ id: '/login', path: '/login', getParentRoute: () => rootRouteImport } as any)
const AuthLayoutRoute = AuthLayoutRouteImport.update({ id: '/_authenticated', getParentRoute: () => rootRouteImport } as any)
const AuthIndexRoute = AuthIndexRouteImport.update({ id: '/', path: '/', getParentRoute: () => AuthLayoutRoute } as any)
const DashManagerRoute = DashManagerRouteImport.update({ id: '/dashboard/manager', path: '/dashboard/manager', getParentRoute: () => AuthLayoutRoute } as any)
const DashBranchRoute = DashBranchRouteImport.update({ id: '/dashboard/branch', path: '/dashboard/branch', getParentRoute: () => AuthLayoutRoute } as any)
const DashAdminRoute = DashAdminRouteImport.update({ id: '/dashboard/admin', path: '/dashboard/admin', getParentRoute: () => AuthLayoutRoute } as any)
const DashSuperAdminRoute = DashSuperAdminRouteImport.update({ id: '/dashboard/super-admin', path: '/dashboard/super-admin', getParentRoute: () => AuthLayoutRoute } as any)

export interface FileRoutesByFullPath {
  '/': typeof AuthIndexRoute
  '/login': typeof LoginRoute
  '/dashboard/manager': typeof DashManagerRoute
  '/dashboard/branch': typeof DashBranchRoute
  '/dashboard/admin': typeof DashAdminRoute
  '/dashboard/super-admin': typeof DashSuperAdminRoute
}
export interface FileRoutesByTo {
  '/': typeof AuthIndexRoute
  '/login': typeof LoginRoute
  '/dashboard/manager': typeof DashManagerRoute
  '/dashboard/branch': typeof DashBranchRoute
  '/dashboard/admin': typeof DashAdminRoute
  '/dashboard/super-admin': typeof DashSuperAdminRoute
}
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
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: '/' | '/login' | '/dashboard/manager' | '/dashboard/branch' | '/dashboard/admin' | '/dashboard/super-admin'
  fileRoutesByTo: FileRoutesByTo
  to: '/' | '/login' | '/dashboard/manager' | '/dashboard/branch' | '/dashboard/admin' | '/dashboard/super-admin'
  id: '__root__' | '/' | '/login' | '/_authenticated' | '/_authenticated/' | '/_authenticated/dashboard/manager' | '/_authenticated/dashboard/branch' | '/_authenticated/dashboard/admin' | '/_authenticated/dashboard/super-admin'
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
  }
}

interface AuthLayoutRouteChildren {
  AuthIndexRoute: typeof AuthIndexRoute
  DashManagerRoute: typeof DashManagerRoute
  DashBranchRoute: typeof DashBranchRoute
  DashAdminRoute: typeof DashAdminRoute
  DashSuperAdminRoute: typeof DashSuperAdminRoute
}
const AuthLayoutRouteChildren: AuthLayoutRouteChildren = {
  AuthIndexRoute,
  DashManagerRoute,
  DashBranchRoute,
  DashAdminRoute,
  DashSuperAdminRoute,
}
const AuthLayoutRouteWithChildren = AuthLayoutRoute._addFileChildren(AuthLayoutRouteChildren)

export interface RootRouteChildren {
  IndexRoute: typeof IndexRoute
  LoginRoute: typeof LoginRoute
  AuthLayoutRoute: typeof AuthLayoutRouteWithChildren
}
const rootRouteChildren: RootRouteChildren = {
  IndexRoute,
  LoginRoute,
  AuthLayoutRoute: AuthLayoutRouteWithChildren,
}
export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>()
