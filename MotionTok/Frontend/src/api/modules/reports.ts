/** 신고 API (명세 §7). */
import { http } from '../http'
import type { ReportRequest } from '../types'

export const reportsApi = {
  report: (body: ReportRequest) => http.post<void>('/reports', body),
}
