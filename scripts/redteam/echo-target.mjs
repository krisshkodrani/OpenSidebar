/**
 * Generation-only Promptfoo target. `redteam:page-content:generate` never
 * evaluates it; it exists so Promptfoo can validate the target configuration.
 */
export default class EchoTarget {
  id = () => "opensidebar-page-content-generation-only";

  callApi = async (prompt) => ({
    output: prompt,
  });
}
