import * as core from "@actions/core";
import * as github from "@actions/github";
import { Octokit } from "@octokit/rest";

async function run() {
  try {
    // Get inputs
    const token = core.getInput("repo-token");
    const daysInactive = parseInt(core.getInput("days-inactive"), 10);
    const checkInMessage = core.getInput("check-in-message");
    const commentMessage = core.getInput("comment-message");
    const botUsername = core.getInput("bot-username");
    const ignoreLabel = core.getInput("ignore-label") || "ignore-checkin";

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

      // Log all comment authors for debugging
      core.info(`Issue/PR #${item.number} comment authors: ${comments.map(c => c.user?.login).join(", ")}`);

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
        (lastBotActivity === null || 
         (now.getTime() - lastBotActivity.getTime()) / (1000 * 60 * 60 * 24) >= daysInactive);

      if (shouldComment) {
        // Debug logging
        core.info(`Original comment message: "${commentMessage}"`);
        core.info(`Check-in message value: "${checkInMessage}"`);
        core.info(`Days inactive value: ${daysInactive}`);
        
        // First, clean up the input by removing any artifacts from workflow variable interpolation
        let finalMessage = commentMessage;
        
        // Simple direct string replacement - sometimes more reliable than regex
        const checkInVar = "{{ check-in-message }}";
        const daysInactiveVar = "{{ days-inactive }}";
        
        if (finalMessage.includes(checkInVar)) {
          core.info(`Found check-in-message template variable using direct string match`);
          finalMessage = finalMessage.split(checkInVar).join(checkInMessage);
        } else {
          core.info(`No exact match for "${checkInVar}" found`);
        }
        
        if (finalMessage.includes(daysInactiveVar)) {
          core.info(`Found days-inactive template variable using direct string match`);
          finalMessage = finalMessage.split(daysInactiveVar).join(daysInactive.toString());
        } else {
          core.info(`No exact match for "${daysInactiveVar}" found`);
        }
        
        // Dump the comment message character by character for debugging
        core.info(`Comment message character codes: ${[...commentMessage].map(c => c.charCodeAt(0)).join(',')}`);
        
        // Check for any remaining template variables
        const remainingTemplates = finalMessage.match(/\{\{.*?\}\}/g);
        if (remainingTemplates) {
          core.info(`WARNING: Found unprocessed template variables: ${remainingTemplates.join(', ')}`);
          
          // As a last resort, try to handle any other template variables
          for (const template of remainingTemplates) {
            core.info(`Trying to process: ${template}`);
            
            if (template.includes('check-in-message')) {
              finalMessage = finalMessage.replace(template, checkInMessage);
            } else if (template.includes('days-inactive')) {
              finalMessage = finalMessage.replace(template, daysInactive.toString());
            }
          }
        }
        
        core.info(`Final processed comment message: "${finalMessage}"`);
        
        // Post the comment
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: item.number,
          body: finalMessage,
        });
      } else {
        core.info(`Skipping comment on issue/PR #${item.number}: daysSinceLastUser=${daysSinceLastUser.toFixed(2)}, lastBotActivity=${lastBotActivity ? lastBotActivity.toISOString() : 'null'}`);
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
 