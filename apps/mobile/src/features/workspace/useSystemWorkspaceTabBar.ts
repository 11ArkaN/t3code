import { Platform } from "react-native";
import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";
import { useDeviceType, useNativeLayoutMetrics } from "../../native/native-layout-metrics";

/**
 * "picker" on the unfolded Duo in portrait, whose overlay sidebar has no system rail beside it.
 * Its search stays in the header, and the thread composer takes its larger controls there.
 */
export function useSidebarWorkspaceTabs(): "picker" | null {
  const { layout } = useAdaptiveWorkspaceLayout();
  const deviceType = useDeviceType();
  const metrics = useNativeLayoutMetrics();
  return Platform.OS === "ios" &&
    layout.usesSplitView &&
    deviceType === "duo-unfolded" &&
    (metrics?.verticalBarEdge ?? "none") === "none"
    ? "picker"
    : null;
}
