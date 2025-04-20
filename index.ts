import * as core from "@actions/core";
import * as github from "@actions/github";
import { Octokit } from "@octokit/rest";

async function run() {
  try {
    // Get inputs
    const token: string = core.getInput("repo-token");
    const daysInactive: number = parseInt(core.getInput("days-inactive"), 10);
    const commentMessage: string = core.getInput("comment-message");
    const botUsername: string = core.getInput("bot-username");
    const ignoreLabel: string = core.getInput("ignore-label") || "ignore-checkin";

    // Set up Octokit
    const octokit = new Octokit({ auth: token });
    const { owner, repo } = github.context.repo;

    // Search for open issues and PRs without the ignore label
    const query = `repo:${owner}/${repo} is:open -label:${ignoreLabel}`;
    const searchResponse = await octokit.paginate(octokit.search.issuesAndPullRequests, {
      q: query,
      per_page: 100,
    });

    const now = new Date();

    for (const item of searchResponse) {
      // Fetch all comments for the issue or PR
      const comments = await octokit.paginate(octokit.issues.listComments, {
        owner,
        repo,
        issue_number: item.number,
        per_page: 100,
      });

      // Find last user activity (most recent non-bot comment or issue creation)
      const userComments = comments.filter((c) => c.user?.login !== botUsername);
      let lastUserActivity = userComments.length > 0
        ? new Date(Math.max(...userComments.map((c) => new Date(c.created_at).getTime())))
        : new Date(item.created_at);

      // Find last bot activity (most recent bot comment, if any)
      const botComments = comments.filter((c) => c.user?.login === botUsername);
      const lastBotActivity = botComments.length > 0
        ? new Date(Math.max(...botComments.map((c) => new Date(c.created_at).getTime())))
        : null;

      // Calculate days since last user activity
      const daysSinceLastUser = (now.getTime() - lastUserActivity.getTime()) / (1000 * 60 * 60 * 24);

      // Check if a comment should be posted
      const shouldComment =
        daysSinceLastUser >= daysInactive &&
        (lastBotActivity === null || lastBotActivity < lastUserActivity);

      if (shouldComment) {
        // Post the comment
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: item.number,
          body: commentMessage,
        });
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unknown error occurred.");
    }
  }
}

run();
