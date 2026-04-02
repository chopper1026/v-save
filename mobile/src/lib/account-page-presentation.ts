export const resolveAccountPagePresentation = (): {
  contentLayout: 'single-column';
  showOverviewPanel: false;
  detailFields: ['phone', 'email', 'status', 'downloads'];
} => {
  return {
    contentLayout: 'single-column',
    showOverviewPanel: false,
    detailFields: ['phone', 'email', 'status', 'downloads'],
  };
};

export const resolveAccountCoverPresentation = (): {
  avatarInteraction: 'press-avatar';
  nicknameInteraction: 'inline-edit-icon';
  showStatusBadge: false;
  showStatsRow: false;
} => {
  return {
    avatarInteraction: 'press-avatar',
    nicknameInteraction: 'inline-edit-icon',
    showStatusBadge: false,
    showStatsRow: false,
  };
};
