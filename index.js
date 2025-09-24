const { VertexAI } = require('@google-cloud/vertexai');
const functions = require('@google-cloud/functions-framework');

// Initialize Vertex AI outside the handler for better performance
const vertex_ai = new VertexAI({ 
  project: 'new-man-app', 
  location: 'us-central1' 
});

functions.http('getSummaryAnalysis', async (req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    // Validate request body
    if (!req.body || typeof req.body !== 'object' || !Array.isArray(req.body.analyses) || !Array.isArray(req.body.prioritizedVirtues)) {
      return res.status(400).send({ error: 'Invalid request body: Expected analyses and prioritizedVirtues arrays.' });
    }

    const { analyses, prioritizedVirtues } = req.body;
    
    // Using the exact same successful model fallback strategy
    const modelNames = [
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash-lite',
      'gemini-1.5-flash-lite',
      'gemini-1.5-flash',
      'gemini-pro'
    ];

    let summaryText = '';
    let lastError = null;
    let successfulModel = '';
    
    const priorityList = prioritizedVirtues.map((v, i) => `${i + 1}. ${v.virtue} (Score: ${(10 - v.defectIntensity).toFixed(1)})`).join('\n');
    const combinedAnalyses = analyses.map(a => `- ${a.virtue}: ${a.analysis}`).join('\n\n');

    // Try each model until one works
    for (const modelName of modelNames) {
      try {
        console.log(`Trying summary model: ${modelName}`);
        
        const generativeModel = vertex_ai.getGenerativeModel({
          model: modelName,
          generationConfig: {
            maxOutputTokens: 1024,
            temperature: 0.7,
            topP: 0.8,
            topK: 40
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
          ]
        });

        // New prompt specifically for generating the summary
        const prompt = `
          As an expert virtuous coach who empathizes with those in recovery, synthesize the following 12 individual virtue analyses into a single, holistic summary for a practitioner to guide virtue growth. The response should be approximately 200 words. Use "you" familiar language to address the user directly.

          **INPUT DATA:**

          **1. User's Prioritized Virtue List (from highest to lowest priority for development):**
          ${priorityList}

          **2. Individual Virtue Analyses:**
          ${combinedAnalyses}

          **TASKS:**
          1.  **Identify Overarching Themes:** Analyze all 12 reports to find common patterns or root causes. For example, do issues with Honesty, Integrity, and Responsibility all point to a core challenge with accountability? Or do struggles with Patience and Self-Control indicate a broader issue with emotional regulation?
          2.  **State the Primary Growth Area:** Begin with a direct statement identifying the user's most significant area for development, referencing the top 2-3 virtues from the priority list that scored the lowest. The lower the score the greater the development need.
          3.  **Commend Strengths:** Briefly acknowledge any virtues where the user shows relative strength or balance. Virtues with scores above 7.0 can be mentioned here.
          4.  **Provide a Synthesis:** Briefly explain how the identified themes connect across multiple virtues.
          5.  **Conclude with a Strategic Recommendation:** Offer a high-level recommendation or a key question for the practitioner to focus on with the user that addresses the core theme.
          6.  Keep the entire response under 300 words.`;

        const result = await generativeModel.generateContent(prompt);
        const response = result.response;
        
        if (response.candidates && response.candidates[0] && response.candidates[0].content) {
          summaryText = response.candidates[0].content.parts[0].text;
          successfulModel = modelName;
          console.log(`Success with summary model: ${modelName}`);
          break;
        } else {
          throw new Error('Invalid response format from summary model');
        }
        
      } catch (error) {
        lastError = error;
        console.warn(`Summary model ${modelName} failed:`, error.message);
        continue; // Try next model
      }
    }

    if (!summaryText) {
      console.error('All summary models failed:', lastError);
      // Provide a meaningful fallback summary response
      summaryText = `A full summary could not be generated at this time. Based on the data, the primary areas for development appear to be ${prioritizedVirtues.slice(0, 2).map(v => v.virtue).join(' and ')}. Focusing on the root causes of challenges in these areas is a recommended next step.`;
    }

    res.status(200).send({ 
      summary: summaryText,
      model: successfulModel || 'fallback',
      success: true 
    });

  } catch (error) {
    console.error('Unexpected error in getSummaryAnalysis:', error);
    res.status(500).send({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

