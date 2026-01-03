const express = require('express');
const youtubedl = require('youtube-dl-exec');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Set EJS as view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.static('public'));

// Get ffmpeg path from ffmpeg-static
const ffmpegPath = require('ffmpeg-static');
const ffmpegDir = path.dirname(ffmpegPath);

// Main page route
app.get('/', (req, res) => {
    res.render('index');
});

// Get video info
app.get('/video-info', async (req, res) => {
    try {
        const { videoUrl } = req.query;
        
        if (!videoUrl) {
            return res.status(400).json({ error: 'Video URL is required' });
        }

        const videoInfo = await youtubedl(videoUrl, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            ffmpegLocation: ffmpegDir
        });

        const info = {
            title: videoInfo.title,
            duration: videoInfo.duration,
            thumbnail: videoInfo.thumbnail,
            author: videoInfo.uploader
        };

        res.json(info);
    } catch (error) {
        console.error('Video info error:', error);
        res.status(500).json({ error: 'Failed to fetch video info: ' + error.message });
    }
});

// Download route
app.post('/download', async (req, res) => {
    let tempFilePath = null;
    
    try {
        const { videoUrl } = req.body;
        
        if (!videoUrl) {
            return res.status(400).json({ error: 'Video URL is required' });
        }

        // Get video info first
        const videoInfo = await youtubedl(videoUrl, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            ffmpegLocation: ffmpegDir
        });

        // Sanitize title
        const title = videoInfo.title
            .replace(/[^\w\s-]/gi, '')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .trim();
        const safeTitle = title.substring(0, 50);
        
        // Ensure temp directory exists
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const timestamp = Date.now();
        const baseFileName = `${timestamp}-${safeTitle}`;
        tempFilePath = path.join(tempDir, `${baseFileName}.mp3`);

        console.log('Downloading and converting audio...');
        
        // Download and convert
        await youtubedl(videoUrl, {
            extractAudio: true,
            audioFormat: 'mp3',
            audioQuality: 0,
            output: tempFilePath,
            noCheckCertificates: true,
            noWarnings: true,
            ffmpegLocation: ffmpegDir
        });

        console.log('Download and conversion completed successfully');
        
        // Verify the file exists
        if (!fs.existsSync(tempFilePath)) {
            throw new Error(`Converted file not found at: ${tempFilePath}`);
        }
        
        console.log('File exists at:', tempFilePath);
        console.log('File size:', fs.statSync(tempFilePath).size, 'bytes');

        // Set headers and send file
        res.header('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
        res.header('Content-Type', 'audio/mpeg');

        const fileStream = fs.createReadStream(tempFilePath);
        fileStream.pipe(res);

        // Clean up temp file after sending
        fileStream.on('end', () => {
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
                console.log('Cleaned up temp file:', tempFilePath);
            }
        });
        fileStream.on('error', (error) => {
            console.error('Stream error:', error);
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        });

    } catch (error) {
        console.error('Download error:', error);
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }
        res.status(500).json({ error: 'Failed to download audio: ' + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`FFmpeg location: ${ffmpegDir}`);
});