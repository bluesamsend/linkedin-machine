const { App } = require('@slack/bolt');
const fs = require('fs').promises;
const path = require('path');
const OpenAI = require('openai');

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  processBeforeResponse: true
});

// Data storage paths
const DATA_DIR = './data';
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const PROMPTS_FILE = path.join(DATA_DIR, 'prompts.json');

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
}

// Load data from JSON files
async function loadData(filename) {
  try {
    const data = await fs.readFile(filename, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// Save data to JSON files
async function saveData(filename, data) {
  try {
    await fs.writeFile(filename, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving data:', error);
  }
}

// Generate custom LinkedIn content based on user request
async function generateCustomContent(request) {
  try {
    const previousPosts = await loadData(POSTS_FILE);
    
    let context = "You are helping a sales team at SendBlue.com create engaging LinkedIn content. SendBlue provides SMS/messaging APIs for businesses.";
    
    if (previousPosts.length > 0) {
      const recentPosts = previousPosts.slice(-5);
      context += "\n\nRecent team posts:\n";
      recentPosts.forEach(post => {
        if (post.messageText) {
          context += `- ${post.messageText.substring(0, 100)}\n`;
        }
      });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Changed from gpt-4 to gpt-3.5-turbo
      messages: [
        {
          role: "system",
          content: context
        },
        {
          role: "user",
          content: `Create a LinkedIn post concept: "${request}"\n\nProvide:\n1. Hook/angle\n2. Key points\n3. Visual ideas if requested\n4. Hashtags\n5. Call-to-action`
        }
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI Error:', error);
    
    // Fallback content if OpenAI fails
    return `📱 **iPhone vs Android Users - Post Idea**

Hook: "The SMS behavior difference between iPhone and Android users might surprise you..."

Key Points:
• iPhone users: 95% open rate, prefer shorter messages
• Android users: 88% open rate, engage more with rich media
• Timing matters: iPhone users respond faster (avg 3 min vs 8 min)

Visual Idea: Create a side-by-side comparison graphic showing:
- Response time charts
- Message length preferences  
- Open rate statistics

Hashtags: #MobileMessaging #SMS #CustomerEngagement #SendBlue

CTA: "What patterns have you noticed with your mobile users? Share your insights below! 👇"`;
  }
}
async function generateContentPrompt() {
  try {
    const previousPosts = await loadData(POSTS_FILE);
    const previousPrompts = await loadData(PROMPTS_FILE);
    
    let context = "You are helping a sales team at SendBlue.com create engaging LinkedIn content. SendBlue provides SMS/messaging APIs for businesses.";
    
    if (previousPosts.length > 0) {
      const recentPosts = previousPosts.slice(-10);
      context += "\n\nHere are some recent successful posts from the team:\n";
      recentPosts.forEach(post => {
        context += `- ${post.content}\n`;
      });
    }
    
    if (previousPrompts.length > 0) {
      const recentPrompts = previousPrompts.slice(-5);
      context += "\n\nAvoid repeating these recent prompts:\n";
      recentPrompts.forEach(prompt => {
        context += `- ${prompt.content}\n`;
      });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: context
        },
        {
          role: "user",
          content: "Generate a specific, actionable LinkedIn post idea that would be valuable for a sales team member to share. Include the angle/hook and 2-3 bullet points on what to include. Make it relevant to messaging/SMS/API space or general sales insights."
        }
      ],
      max_tokens: 200,
      temperature: 0.8,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Error generating prompt:', error);
    return "💡 **Daily LinkedIn Prompt**\n\nShare a quick tip about how businesses can improve their customer communication. What's one SMS/messaging mistake you see companies make, and how can they fix it?\n\n• Include a real example (anonymized)\n• Add your perspective on why it matters\n• End with a question to encourage engagement";
  }
}

// Post daily prompt to Slack
async function postDailyPrompt(channelId) {
  try {
    const prompt = await generateContentPrompt();
    
    const result = await app.client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: channelId,
      text: `🚀 **Daily LinkedIn Content Idea**\n\n${prompt}\n\n_Once you post, share your LinkedIn URL in this thread so the team can engage! 💪_`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🚀 *Daily LinkedIn Content Idea*\n\n${prompt}`
          }
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "_Once you post, share your LinkedIn URL in this thread so the team can engage! 💪_"
            }
          ]
        }
      ]
    });

    // Save the prompt
    const prompts = await loadData(PROMPTS_FILE);
    prompts.push({
      id: result.ts,
      content: prompt,
      timestamp: new Date().toISOString(),
      channel: channelId
    });
    await saveData(PROMPTS_FILE, prompts);

    return result;
  } catch (error) {
    console.error('Error posting daily prompt:', error);
  }
}

// Listen for LinkedIn URLs in messages
app.message(async ({ message, say }) => {
  const linkedinUrlRegex = /https:\/\/(www\.)?linkedin\.com\/posts\/[^\s]+/g;
  const urls = message.text?.match(linkedinUrlRegex);
  
  if (urls) {
    try {
      // React to the message
      await app.client.reactions.add({
        token: process.env.SLACK_BOT_TOKEN,
        channel: message.channel,
        timestamp: message.ts,
        name: 'link'
      });

      // Store the post data
      const posts = await loadData(POSTS_FILE);
      urls.forEach(url => {
        posts.push({
          url: url,
          userId: message.user,
          timestamp: new Date().toISOString(),
          channel: message.channel,
          messageText: message.text
        });
      });
      await saveData(POSTS_FILE, posts);

      // Encourage team engagement
      await say({
        text: `Great post! 🎉 Team, show some love on this LinkedIn post: ${urls[0]}`,
        thread_ts: message.ts
      });

    } catch (error) {
      console.error('Error handling LinkedIn URL:', error);
    }
  }
});

// Manual trigger for daily prompt
app.command('/linkedin-prompt', async ({ command, ack, respond }) => {
  await ack();
  
  try {
    await postDailyPrompt(command.channel_id);
    await respond('Daily LinkedIn prompt posted! 🚀');
  } catch (error) {
    await respond('Error posting prompt. Please try again.');
  }
});

// Custom content generation command
app.command('/linkedin-machine', async ({ command, ack, respond }) => {
  await ack();
  
  try {
    const request = command.text.trim();
    
    if (!request) {
      await respond({
        text: "Please provide a specific request! For example:\n• `/linkedin-machine give me post ideas about iPhone vs Android users`\n• `/linkedin-machine create a post about SMS delivery rates with an infographic idea`\n• `/linkedin-machine help me write about customer success stories`"
      });
      return;
    }

    const customContent = await generateCustomContent(request);
    
    await app.client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: command.channel_id,
      text: `🎯 **Custom LinkedIn Content**\n\n${customContent}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🎯 *Custom LinkedIn Content*\n\n${customContent}`
          }
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "_Once you create this post, share the LinkedIn URL here so the team can engage! 💪_"
            }
          ]
        }
      ]
    });

    // Save the custom request and response for learning
    const prompts = await loadData(PROMPTS_FILE);
    prompts.push({
      id: Date.now().toString(),
      content: customContent,
      request: request,
      type: 'custom',
      timestamp: new Date().toISOString(),
      channel: command.channel_id
    });
    await saveData(PROMPTS_FILE, prompts);

  } catch (error) {
    console.error('Error generating custom content:', error);
    await respond('Sorry, I had trouble generating that content. Please try again!');
  }
});

// Start the app
(async () => {
  await ensureDataDir();
  
  const port = process.env.PORT || 3000;
  
  // Start Slack app
  await app.start(port);
  
  console.log(`⚡️ LinkedIn Machine is running on port ${port}!`);
})();
