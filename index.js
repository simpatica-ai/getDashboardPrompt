const { VertexAI } = require('@google-cloud/vertexai');
const functions = require('@google-cloud/functions-framework');

// Initialize Vertex AI outside the handler for better performance
const vertex_ai = new VertexAI({ 
  project: 'new-man-app', 
  location: 'us-central1' 
});

functions.http('getDashboardPrompt', async (req, res) => {
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
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).send({ error: 'Invalid request body' });
    }

    const { 
      assessmentSummary, 
      prioritizedVirtues, 
      stageProgress, 
      recentProgress,
      isFirstTime = false 
    } = req.body;
    
    // Using the same successful model fallback strategy
    const modelNames = [
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash-lite',
      'gemini-1.5-flash-lite',
      'gemini-1.5-flash',
      'gemini-pro'
    ];

    let promptText = '';
    let lastError = null;
    let successfulModel = '';
    
    // Prepare input data for the prompt
    const virtueList = prioritizedVirtues?.map((v, i) => 
      `${i + 1}. ${v.virtue} (Score: ${(10 - v.defectIntensity).toFixed(1)})`
    ).join('\n') || 'No assessment data available';

    const progressSummary = stageProgress ? Object.entries(stageProgress)
      .map(([key, status]) => {
        const [virtueId, stage] = key.split('-');
        const virtue = prioritizedVirtues?.find(v => v.virtueId == virtueId);
        const stageName = stage == '1' ? 'Dismantling' : stage == '2' ? 'Building' : 'Practicing';
        return `${virtue?.virtue || 'Unknown'} - ${stageName}: ${status}`;
      }).join('\n') : 'No progress data available';

    const recentUpdate = recentProgress || 'No recent updates';

    // Try each model until one works
    for (const modelName of modelNames) {
      try {
        console.log(`Trying model: ${modelName}`);
        
        const generativeModel = vertex_ai.getGenerativeModel({
          model: modelName,
          generationConfig: {
            maxOutputTokens: 200, // Reduced for 150 word limit
            temperature: 0.4, // Reduced from 0.7 for more focused responses
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

        const prompt = `
As a virtue development coach, provide personalized next-step guidance for a user viewing their virtue dashboard. Use warm, encouraging language with "you" to address them directly.

**STAGE DEFINITIONS:**
- Discovery: Complete virtue assessment to identify growth areas
- Dismantling: Recognize and work through character defects that block virtue
- Building: Develop understanding and practice of the virtue itself  
- Practicing: Apply virtue consistently in daily life (only after completing Dismantling and Building)

**USER DATA:**

Assessment Summary: ${assessmentSummary || 'Assessment completed'}

Prioritized Virtues (lowest scores need most work):
${virtueList}

Current Stage Progress:
${progressSummary}

Recent Progress: ${recentUpdate}

First-time user: ${isFirstTime}

**GUIDANCE RULES:**
1. **PRIMARY FOCUS**: Always direct attention to the LOWEST-SCORING virtue (highest priority for development) from the prioritized list
2. If first-time/empty dashboard: Encourage starting with #1 lowest-scoring virtue's Dismantling stage
3. **Structure**: Lead with next step recommendation, then briefly acknowledge progress if relevant
4. Recommend completing all Dismantling stages before Building, or work virtue-by-virtue (Dismantling → Building)
5. Discourage Practicing until both Dismantling and Building are complete for that virtue
6. STRICT LIMIT: Maximum 150 words total
7. End with a specific actionable next step focusing on the lowest-scoring virtue

**PRIORITY**: Focus on the #1 virtue (lowest score) unless it's completely finished (both Dismantling and Building completed).

Generate a personalized, encouraging message directing them to their next virtue development step. Lead with the recommended action for the lowest-scoring virtue, keep it concise and under 150 words:`;

        const result = await generativeModel.generateContent(prompt);
        const response = result.response;
        
        if (response.candidates && response.candidates[0] && response.candidates[0].content) {
          let generatedText = response.candidates[0].content.parts[0].text;
          
          // Enforce 150 word limit by truncating if necessary
          const words = generatedText.split(/\s+/);
          if (words.length > 150) {
            generatedText = words.slice(0, 150).join(' ') + '...';
          }
          
          promptText = generatedText;
          successfulModel = modelName;
          console.log(`Success with model: ${modelName}`);
          break;
        } else {
          throw new Error('Invalid response format from model');
        }
        
      } catch (error) {
        lastError = error;
        console.warn(`Model ${modelName} failed:`, error.message);
        continue; // Try next model
      }
    }

    if (!promptText) {
      console.error('All models failed:', lastError);
      // Provide a meaningful fallback
      const topVirtue = prioritizedVirtues?.[0]?.virtue || 'your priority virtue';
      promptText = `Welcome to your virtue development journey! ${isFirstTime ? `Start by working on ${topVirtue} in the Dismantling stage to begin recognizing character defects.` : `Continue your progress by focusing on the next stage of ${topVirtue}.`} Click the stage buttons to begin your reflection.`;
    }

    res.status(200).send({ 
      prompt: promptText,
      model: successfulModel || 'fallback',
      success: true 
    });

  } catch (error) {
    console.error('Unexpected error in getDashboardPrompt:', error);
    res.status(500).send({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

