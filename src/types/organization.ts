export interface CreateOrganizationBody {
  name: string;
  slaMinutes?: number;
  slaEnabled?: boolean;
  weeklyReportEnabled?: boolean;
  weeklyReportDay?: number | null;
  notifyOnBreach?: boolean;
}

export interface UpdateOrganizationBody {
  name?: string;
  settings?: {
    slaMinutes?: number;
    slaEnabled?: boolean;
    weeklyReportEnabled?: boolean;
    weeklyReportDay?: number | null;
    notifyOnBreach?: boolean;
  };
}
