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

// Generate LinkedIn content prompt using AI
async function generateContentPrompt() {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a LinkedIn content coach helping a sales team at Sendblue.com create engaging posts. Provide one clear post idea with a hook and 2-3 key points. NO hashtags, NO CTAs. Keep it simple and authentic."
        },
        {
          role: "user",
          content: "Generate a LinkedIn post idea about SMS/messaging for a sales team."
        }
      ],
      max_tokens: 200,
      temperature: 0.8,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Error generating prompt:', error);
    return "Share a lesson you learned about customer communication this week. What surprised you?";
  }
}

// Post daily prompt to Slack
async function postDailyPrompt(channelId) {
  try {
    const prompt = await generateContentPrompt();
    
    const result = await app.client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: channelId,
      text: `🚀 Daily LinkedIn Idea\n\n${prompt}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🚀 *Daily LinkedIn Idea*\n\n${prompt}`
          }
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
        text: `Great post! 🎉 Team, show some love: ${urls[0]}`,
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
        text: "Give me a topic! Example: `/linkedin-machine iPhone vs Android users`"
      });
      return;
    }

    // Generate content with AI
    let content = "";
    let useAI = true;
    
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a LinkedIn content coach helping a modern sales leader write engaging posts. Provide 3 post ideas with hooks and key points. Include 2 relevant article links for inspiration. NO hashtags, NO CTAs. Keep it simple and scroll-stopping."
          },
          {
            role: "user",
            content: `Give me 3 LinkedIn post ideas about: "${request}"`
          }
        ],
        max_tokens: 400,
        temperature: 0.8,
      });

      content = completion.choices[0].message.content;
      
    } catch (aiError) {
      console.log('AI failed:', aiError.message);
      useAI = false;
      content = `**3 Post Ideas: ${request}**\n\n**Idea 1:** Share a personal observation\n**Idea 2:** Reference industry data\n**Idea 3:** Tell a story about lessons learned\n\n*AI generation failed - try again!*`;
    }

    // Post the content
    await app.client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: command.channel_id,
      text: `🎯 LinkedIn Post Ideas\n\n${content}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🎯 *LinkedIn Post Ideas*${useAI ? ' (AI)' : ' (Fallback)'}\n\n${content}`
          }
        }
      ]
    });

    // Save the request
    const prompts = await loadData(PROMPTS_FILE);
    prompts.push({
      id: Date.now().toString(),
      content: content,
      request: request,
      type: useAI ? 'ai_generated' : 'fallback',
      timestamp: new Date().toISOString(),
      channel: command.channel_id
    });
    await saveData(PROMPTS_FILE, prompts);

  } catch (error) {
    console.error('Error generating content:', error);
    await respond('Sorry, something went wrong. Try again!');
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
