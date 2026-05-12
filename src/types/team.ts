export interface CreateTeamBody {
  name: string;
  slaMinutes?: number;
  slaEnabled?: boolean;
  weeklyReportEnabled?: boolean;
  weeklyReportDay?: number | null;
  notifyOnBreach?: boolean;
}

export interface UpdateTeamBody {
  name?: string;
  settings?: {
    slaMinutes?: number;
    slaEnabled?: boolean;
    weeklyReportEnabled?: boolean;
    weeklyReportDay?: number | null;
    notifyOnBreach?: boolean;
  };
}
