// NexusExposureQuantifier API client.
// Every method is a same-origin relative call to /api/proxy/<path>, which maps
// 1:1 to the backend /api/v1/<path>. The proxy route injects X-User-Id.

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function req(path: string, init?: RequestInit) {
  const res = await fetch(`/api/proxy/${path}`, init)
  const text = await res.text()
  let data: any = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `Request failed (${res.status})`
    throw new Error(message)
  }
  return data
}

const get = (path: string) => req(path)
const post = (path: string, body?: unknown) =>
  req(path, { method: 'POST', headers: JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) })
const put = (path: string, body?: unknown) =>
  req(path, { method: 'PUT', headers: JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) })
const del = (path: string) => req(path, { method: 'DELETE' })

function qs(params?: Record<string, string | number | boolean | undefined | null>) {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const api = {
  // Workspaces
  listWorkspaces: () => get('workspaces'),
  createWorkspace: (body: unknown) => post('workspaces', body),
  getWorkspace: (id: string) => get(`workspaces/${id}`),
  updateWorkspace: (id: string, body: unknown) => put(`workspaces/${id}`, body),
  deleteWorkspace: (id: string) => del(`workspaces/${id}`),
  listMembers: (id: string) => get(`workspaces/${id}/members`),
  addMember: (id: string, body: unknown) => post(`workspaces/${id}/members`, body),
  removeMember: (id: string, memberId: string) => del(`workspaces/${id}/members/${memberId}`),

  // Engagements
  listEngagements: (workspaceId?: string) => get(`engagements${qs({ workspace_id: workspaceId })}`),
  createEngagement: (body: unknown) => post('engagements', body),
  getEngagement: (id: string) => get(`engagements/${id}`),
  updateEngagement: (id: string, body: unknown) => put(`engagements/${id}`, body),
  deleteEngagement: (id: string) => del(`engagements/${id}`),
  cloneEngagement: (id: string, body?: unknown) => post(`engagements/${id}/clone`, body),
  lockEngagement: (id: string, body?: unknown) => post(`engagements/${id}/lock`, body),
  recomputeEngagement: (id: string, body?: unknown) => post(`engagements/${id}/recompute`, body),

  // Assumptions
  getAssumptions: (engagementId: string) => get(`assumptions/${engagementId}`),
  updateAssumptions: (engagementId: string, body: unknown) => put(`assumptions/${engagementId}`, body),
  getAssumptionLog: (engagementId: string) => get(`assumptions/${engagementId}/log`),

  // Sales
  listSales: (engagementId: string, state?: string) => get(`sales/${engagementId}${qs({ state })}`),
  addSalesLine: (engagementId: string, body: unknown) => post(`sales/${engagementId}`, body),
  bulkAddSales: (engagementId: string, body: unknown) => post(`sales/${engagementId}/bulk`, body),
  deleteAllSales: (engagementId: string) => del(`sales/${engagementId}`),
  deleteSalesLine: (engagementId: string, lineId: string) => del(`sales/${engagementId}/${lineId}`),
  getSalesSummary: (engagementId: string) => get(`sales/${engagementId}/summary`),

  // Imports
  listImports: (engagementId: string) => get(`imports/${engagementId}`),
  importCsv: (engagementId: string, body: unknown) => post(`imports/${engagementId}/csv`, body),
  importConnector: (engagementId: string, body: unknown) => post(`imports/${engagementId}/connector`, body),
  seedSample: (engagementId: string, body?: unknown) => post(`imports/${engagementId}/sample`, body),
  getImportErrors: (engagementId: string, jobId: string) => get(`imports/${engagementId}/${jobId}/errors`),

  // Nexus rules library
  listNexusRules: () => get('nexus-rules'),
  getNexusRule: (state: string) => get(`nexus-rules/${state}`),
  createNexusRule: (body: unknown) => post('nexus-rules', body),
  updateNexusRule: (id: string, body: unknown) => put(`nexus-rules/${id}`, body),

  // Tax rate library
  listTaxRates: () => get('tax-rates'),
  getTaxRate: (state: string) => get(`tax-rates/${state}`),
  createTaxRate: (body: unknown) => post('tax-rates', body),
  updateTaxRate: (id: string, body: unknown) => put(`tax-rates/${id}`, body),

  // Penalty rules library
  listPenaltyRules: () => get('penalty-rules'),
  getPenaltyRule: (state: string) => get(`penalty-rules/${state}`),
  createPenaltyRule: (body: unknown) => post('penalty-rules', body),
  updatePenaltyRule: (id: string, body: unknown) => put(`penalty-rules/${id}`, body),

  // Interest rate library
  listInterestRates: () => get('interest-rates'),
  getInterestRates: (state: string) => get(`interest-rates/${state}`),
  createInterestRate: (body: unknown) => post('interest-rates', body),
  updateInterestRate: (id: string, body: unknown) => put(`interest-rates/${id}`, body),

  // VDA terms library
  listVdaTerms: () => get('vda-terms'),
  getVdaTerm: (state: string) => get(`vda-terms/${state}`),
  createVdaTerm: (body: unknown) => post('vda-terms', body),
  updateVdaTerm: (id: string, body: unknown) => put(`vda-terms/${id}`, body),

  // Taxability
  listTaxability: (engagementId: string) => get(`taxability/${engagementId}`),
  upsertTaxability: (engagementId: string, body: unknown) => post(`taxability/${engagementId}`, body),
  deleteTaxability: (engagementId: string, id: string) => del(`taxability/${engagementId}/${id}`),

  // Crossings
  listCrossings: (engagementId: string) => get(`crossings/${engagementId}`),
  getCrossing: (engagementId: string, state: string) => get(`crossings/${engagementId}/${state}`),
  detectCrossings: (engagementId: string, body?: unknown) => post(`crossings/${engagementId}/detect`, body),

  // Exposure
  listExposure: (engagementId: string) => get(`exposure/${engagementId}`),
  getStateExposure: (engagementId: string, state: string) => get(`exposure/${engagementId}/${state}`),
  computeExposure: (engagementId: string, body?: unknown) => post(`exposure/${engagementId}/compute`, body),

  // Scenarios
  listScenarios: (engagementId: string) => get(`scenarios/${engagementId}`),
  computeScenarios: (engagementId: string, waitMonths?: number, body?: unknown) =>
    post(`scenarios/${engagementId}/compute${qs({ wait_months: waitMonths })}`, body),

  // Materiality
  getMateriality: (engagementId: string, opts?: { threshold?: number; sort?: string }) =>
    get(`materiality/${engagementId}${qs({ threshold: opts?.threshold, sort: opts?.sort })}`),

  // Memos
  listMemos: (engagementId: string) => get(`memos/${engagementId}`),
  generateMemo: (engagementId: string, body: unknown) => post(`memos/${engagementId}`, body),
  getMemo: (engagementId: string, memoId: string) => get(`memos/${engagementId}/${memoId}`),
  deleteMemo: (engagementId: string, memoId: string) => del(`memos/${engagementId}/${memoId}`),

  // Remediation
  getRemediation: (engagementId: string) => get(`remediation/${engagementId}`),
  upsertRemediation: (engagementId: string, body: unknown) => post(`remediation/${engagementId}`, body),
  updateRemediation: (engagementId: string, id: string, body: unknown) => put(`remediation/${engagementId}/${id}`, body),

  // Audit flags
  listAuditFlags: (engagementId: string) => get(`audit-flags/${engagementId}`),
  upsertAuditFlag: (engagementId: string, body: unknown) => post(`audit-flags/${engagementId}`, body),

  // Wait cost
  getWaitCost: (engagementId: string, months?: number) => get(`wait-cost/${engagementId}${qs({ months })}`),

  // Reports
  getWorkingPapers: (engagementId: string) => get(`reports/${engagementId}/working-papers`),
  getSchedule: (engagementId: string) => get(`reports/${engagementId}/schedule`),
  getSummaryReport: (engagementId: string) => get(`reports/${engagementId}/summary`),

  // Comments
  listComments: (engagementId: string, state?: string) => get(`comments/${engagementId}${qs({ state })}`),
  addComment: (engagementId: string, body: unknown) => post(`comments/${engagementId}`, body),
  deleteComment: (engagementId: string, id: string) => del(`comments/${engagementId}/${id}`),

  // Snapshots
  listSnapshots: (engagementId: string) => get(`snapshots/${engagementId}`),
  createSnapshot: (engagementId: string, body?: unknown) => post(`snapshots/${engagementId}`, body),
  getSharedSnapshot: (token: string) => get(`snapshots/shared/${token}`),
  deleteSnapshot: (engagementId: string, id: string) => del(`snapshots/${engagementId}/${id}`),

  // Notifications
  listNotifications: () => get('notifications'),
  markNotificationRead: (id: string) => post(`notifications/${id}/read`),
  markAllNotificationsRead: () => post('notifications/read-all'),

  // Activity
  getActivity: (workspaceId: string) => get(`activity/${workspaceId}`),

  // Analytics
  getAnalyticsOverview: (workspaceId?: string) => get(`analytics/overview${qs({ workspace_id: workspaceId })}`),
  getAnalyticsByState: (engagementId?: string) => get(`analytics/by-state${qs({ engagement_id: engagementId })}`),
  getAnalyticsTrend: (engagementId: string) => get(`analytics/trend/${engagementId}`),

  // Billing
  getBillingPlan: () => get('billing/plan'),
  startCheckout: (body?: unknown) => post('billing/checkout', body),
  openPortal: (body?: unknown) => post('billing/portal', body),
}

export default api
