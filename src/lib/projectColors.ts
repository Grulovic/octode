export const projectColors = [
  ["Turquoise", "#80cbc4"],
  ["Blue", "#68caff"],
  ["Purple", "#bd9df2"],
  ["Pink", "#e6a1cb"],
  ["Red", "#ff787d"],
  ["Orange", "#fb9551"],
  ["Yellow", "#e7d175"],
  ["Green", "#98d792"],
  ["Teal", "#51c5c5"],
  ["Silver", "#b0bec5"],
] as const;
export const projectColor = (color?: string) =>
  projectColors.find(([, value]) => value === color)?.[1] ??
  projectColors[0][1];
