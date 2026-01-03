const express = require('express');
const cors = require('cors');
const playdl = require('play-dl');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

const app = express();

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple function to extract video ID from any YouTube URL
function extractVideoId(url) {
  if (!url) return null;
  
  // If it's already just a video ID (11 characters)
  if (url.length === 11 && !url.includes('/') && !url.includes('?')) {
    return url;
  }
  
  // Try different YouTube URL patterns
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([^&?\/#]+)/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}

// Get video info
async function getVideoInfo(videoUrl) {
  try {
    console.log('Getting info for:', videoUrl);
    
    // Extract video ID and create proper URL
    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      throw new Error('Could not extract video ID from URL');
    }
    
    const fullUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log('Full YouTube URL:', fullUrl);
    
    // Get video info using play-dl
    const info = await playdl.video_info(fullUrl);
    
    return {
      title: info.video_details.title,
      duration: info.video_details.durationRaw,
      channel: info.video_details.channel?.name || 'Unknown',
      thumbnail: info.video_details.thumbnails[0]?.url,
      url: fullUrl
    };
  } catch (error) {
    console.error('Error getting video info:', error.message);
    throw new Error(`Failed to get video info: ${error.message}`);
  }
}

// Download and convert to MP3
async function downloadAsMP3(videoUrl, res) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log('Starting MP3 conversion for:', videoUrl);
      
      // Extract video ID and create proper URL
      const videoId = extractVideoId(videoUrl);
      if (!videoId) {
        throw new Error('Invalid YouTube URL - could not extract video ID');
      }
      
      const properUrl = `https://www.youtube.com/watch?v=${videoId}`;
      console.log('Using URL:', properUrl);
      
      // Get video info first
      const videoInfo = await getVideoInfo(videoUrl);
      console.log('Video title:', videoInfo.title);
      
      // Get audio stream
      console.log('Getting audio stream...');
      const stream = await playdl.stream(properUrl, {
        quality: 2, // High quality audio
        discordPlayerCompatibility: false
      });

      // Create filename from video title
      const filename = `${videoInfo.title}.mp3`
        .replace(/[/\\?%*:|"<>]/g, '_')
        .substring(0, 200);

      // Set response headers
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      console.log('Converting to MP3...');

      // Convert to MP3 using FFmpeg
      ffmpeg(stream.stream)
        .audioBitrate(320)
        .format('mp3')
        .audioCodec('libmp3lame')
        .on('start', () => {
          console.log('FFmpeg conversion started');
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`Processing: ${progress.percent.toFixed(2)}%`);
          }
        })
        .on('error', (err) => {
          console.error('FFmpeg error:', err.message);
          reject(err);
        })
        .on('end', () => {
          console.log('MP3 conversion completed');
          resolve();
        })
        .pipe(res, { end: true });

    } catch (error) {
      console.error('Download error:', error.message);
      reject(error);
    }
  });
}

// API Routes

// Get video info
app.post('/api/video-info', async (req, res) => {
  try {
    const { youtubeUrl } = req.body;
    
    if (!youtubeUrl) {
      return res.status(400).json({ error: 'YouTube URL is required' });
    }
    
    console.log('Video info request for:', youtubeUrl);
    
    const videoInfo = await getVideoInfo(youtubeUrl);
    
    res.json({
      success: true,
      video: videoInfo
    });
    
  } catch (error) {
    console.error('Video info error:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Download as MP3 - SIMPLIFIED VERSION
app.post('/api/download-mp3', async (req, res) => {
  try {
    const { youtubeUrl } = req.body;
    
    if (!youtubeUrl) {
      return res.status(400).json({ error: 'YouTube URL is required' });
    }
    
    console.log('=== DOWNLOAD REQUEST START ===');
    console.log('Received URL:', youtubeUrl);
    
    // Extract video ID directly
    const videoId = extractVideoId(youtubeUrl);
    console.log('Extracted video ID:', videoId);
    
    if (!videoId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid YouTube URL format' 
      });
    }
    
    const properUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log('Proper URL:', properUrl);
    
    // Try to get video info first to verify the video exists
    try {
      const videoInfo = await getVideoInfo(youtubeUrl);
      console.log('Video found:', videoInfo.title);
    } catch (infoError) {
      console.error('Video info error:', infoError.message);
      return res.status(400).json({ 
        success: false, 
        error: `Video not found: ${infoError.message}` 
      });
    }
    
    // Proceed with download
    await downloadAsMP3(youtubeUrl, res);
    
    console.log('=== DOWNLOAD REQUEST END ===');
    
  } catch (error) {
    console.error('Download error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }
});

// Simple GET endpoint for testing
app.get('/api/download', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }
    
    console.log('GET Download request for:', url);
    await downloadAsMP3(url, res);
    
  } catch (error) {
    console.error('Download error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }
});

// Test endpoint to check URL parsing
app.post('/api/debug-url', async (req, res) => {
  try {
    const { youtubeUrl } = req.body;
    
    if (!youtubeUrl) {
      return res.status(400).json({ error: 'YouTube URL is required' });
    }
    
    const videoId = extractVideoId(youtubeUrl);
    
    res.json({
      success: true,
      originalUrl: youtubeUrl,
      extractedVideoId: videoId,
      constructedUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Test endpoint with hardcoded URL
app.get('/api/test-download', async (req, res) => {
  try {
    // Use the video ID from your debug output
    const testUrl = 'https://www.youtube.com/watch?v=kSXt_zQn9Yc';
    console.log('Testing with hardcoded URL:', testUrl);
    await downloadAsMP3(testUrl, res);
  } catch (error) {
    console.error('Test download error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'YouTube to MP3 converter is running',
    timestamp: new Date().toISOString()
  });
});
// const path = require("path");

// app.set("view engine", "ejs");
// app.set("views", path.join(__dirname, "views"));

// app.get("/", (req, res) => {
//   res.render("index");
// });

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 YouTube to MP3 converter running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📥 Download endpoint: POST http://localhost:${PORT}/api/download-mp3`);
  console.log(`🧪 Test download: http://localhost:${PORT}/api/test-download`);
});

module.exports = app;