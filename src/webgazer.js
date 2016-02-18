(function(window, undefined) {
    console.log('initializing webgazer')
    //strict mode for type safety
    "use strict"

    //auto invoke function to bind our own copy of window and undefined
    
    //set up namespaces for modules
    window.gazer = window.gazer || {};
    gazer.tracker = gazer.tracker || {};
    gazer.reg = gazer.reg || {};

    //PRIVATE VARIABLES
    
    //video elements
    var videoScale = .5;
    var videoElement = null;
    var videoElementCanvas = null;
    var imgWidth = 0;
    var imgHeight = 0;

    //debug control boolean
    var showGazeDot = false;
    //debug element (starts offscreen)
    var gazeDot = document.createElement('div');
    gazeDot.style.position = 'absolute';
    gazeDot.style.left = '20px'; //'-999em';
    gazeDot.style.width = '10px';
    gazeDot.style.height = '10px';
    gazeDot.style.background = 'red';
        
    // loop parameters
    var clockStart = performance.now();
    var dataTimestep = 50; //TODO either make this a settable parameter or otherwise determine best value
    var paused = false;
    //registered callback for loop
    var nopCallback = function(data, time) {};
    var callback = nopCallback;

    //movelistener timeout clock parameters
    var moveClock = performance.now();
    var moveTickSize = 50; //milliseconds

    //currently used tracker and regression models, defaults to clmtrackr and linear regression
    var tracker = new gazer.tracker.ClmGaze();
    var reg = new gazer.reg.LinearReg();
    var blinkDetector = new gazer.BlinkDetector();

    //lookup tables
    var trackerMap = {
        'clmtrackr': function() { return new gazer.tracker.ClmGaze(); },
        'trackingjs': function() { return new gazer.tracker.TrackingjsGaze(); },
        'js_objectdetect': function() { return new gazer.tracker.Js_objectdetectGaze(); }
    };
    var regressionMap = {
        'simple': function() { return new gazer.reg.LinearReg(); },
        'interaction': function() { return new gazer.reg.RidgeReg(); }
    };

    //localstorage name
    var localstorageLabel = 'webgazerGlobalData';
    //settings object for future storage of settings
    var settings = {};
    var defaults = {
        'data': [],
        'settings': {},
    };

    //PRIVATE FUNCTIONS

    /**
     * gets the pupil features by following the pipeline which threads an eyes object through each call:
     * tracker gets eye patches -> blink detector -> pupil detection 
     */
    function getPupilFeatures(canvas, width, height) {
        if (!canvas) {
            return;
        }
        paintCurrentFrame(canvas);
        try {
            return gazer.pupil.getPupils(blinkDetector.detectBlink(tracker.getEyePatches(canvas, width, height)));
        } catch(err) {
            console.log(err);
            return null;
        }
    }

    /**
     * gets the most current frame of video and paints it to the canvas
     */
    function paintCurrentFrame(canvas) {
        imgWidth = videoElement.videoWidth * videoScale;
        imgHeight = videoElement.videoHeight * videoScale;

        videoElementCanvas.width = imgWidth;
        videoElementCanvas.height = imgHeight;

        var ctx = canvas.getContext('2d');
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    }

    function getPrediction() {
        var prediction = reg.predict(getPupilFeatures(videoElementCanvas, imgWidth, imgHeight));
        return prediction == null ? null : {
            x : prediction.x,
            y : prediction.y
        };
    }
    /**
     * runs every dataTimestep milliseconds if gazer is not paused
     */
    var smoothingVals = new gazer.util.DataWindow(4);
    function loop() {
        var gazeData = getPrediction();
        var elapsedTime = performance.now() - clockStart;

        callback(gazeData, elapsedTime);

        if (gazeData && showGazeDot) {
            smoothingVals.push(gazeData);
            var x = 0;
            var y = 0;
            var len = smoothingVals.length;
            for (var d in smoothingVals.data) {
                x += smoothingVals.get(d).x;
                y += smoothingVals.get(d).y;
            }
            var pred = gazer.util.bound({'x':x/len, 'y':y/len});
            gazeDot.style.top = pred.y + 'px';
            gazeDot.style.left = pred.x + 'px';
        }

        if (!paused) {
            //setTimeout(loop, dataTimestep);
            requestAnimationFrame(loop);
        }
    }

    /**
     * records click data
     */
    var clickListener = function(event) {
        if (paused) {
            return;
        }
        reg.addData(getPupilFeatures(videoElementCanvas, imgWidth, imgHeight), [event.clientX, event.clientY], 'click');
    }

    /**
     * records click data
     */
    var moveListener = function(event) {
        if (paused) {
            return;
        }

        var now = performance.now();
        if (now < moveClock + moveTickSize) {
            return;
        } else {
            moveClock = now;
        }

        reg.addData(getPupilFeatures(videoElementCanvas, imgWidth, imgHeight), [event.clientX, event.clientY], 'move');
    }

    /** loads the global data and passes it to the regression model 
     * 
     */
    function loadGlobalData() {
        var storage = JSON.parse(window.localStorage.getItem(localstorageLabel)) || defaults;
        settings = storage.settings;
        reg.setData(storage.data);
    }
    
    function setGlobalData() {
        //TODO set localstorage to combined dataset
        var storage = {
            'settings': settings,
            'data': reg.getData()
        };
        window.localStorage.setItem(localstorageLabel, JSON.stringify(storage));
        //TODO data should probably be stored in webgazer object instead of each regression model
        //     -> requires duplication of data, but is likely easier on regression model implementors
    }

    function clearData() {
        window.localStorage.set(localstorageLabel, undefined);
        reg.setData([]);
    }

    //PUBLIC FUNCTIONS - CONTROL

    /**
     * starts all state related to webgazer -> dataLoop, video collection, click listener
     */
    gazer.begin = function() {
        loadGlobalData();

        //SETUP VIDEO ELEMENTS
        navigator.getUserMedia = navigator.getUserMedia ||
            navigator.webkitGetUserMedia ||
            navigator.mozGetUserMedia;

        if(navigator.getUserMedia != null){ 
            var options = { 
                video:true, 
            }; 	     
            //request webcam access 
            navigator.getUserMedia(options, 
                    function(stream){
                        console.log('video stream created');
                        videoElement = document.createElement('video');
                        videoElement.id = 'webgazerVideoFeed'; 
                        videoElement.autoplay = true;
                        console.log(videoElement);
                        videoElement.style.display = 'none';

                        //turn the stream into a magic URL 
                        videoElement.src = window.URL.createObjectURL(stream); 
                        document.body.appendChild(videoElement);

                        videoElementCanvas = document.createElement('canvas'); 
                        videoElementCanvas.id = 'webgazerVideoCanvas';
                        videoElementCanvas.style.display = 'none';
                        document.body.appendChild(videoElementCanvas);

        
                        //third argument set to true so that we get event on 'capture' instead of 'bubbling'
                        //this prevents a client using event.stopPropagation() preventing our access to the click
                        document.addEventListener('click', clickListener, true);
                        document.addEventListener('mousemove', moveListener, true);

                        document.body.appendChild(gazeDot);

                        //BEGIN CALLBACK LOOP
                        paused = false;
                        loop();
                    }, 
                    function(e){ 
                        console.log("No stream"); 
                        videoElement = null;
                    });
        }

        return gazer;
    }

    gazer.isReady = function() {
        if (videoElementCanvas == null) {
            return false;
        }
        paintCurrentFrame(videoElementCanvas);
        return videoElementCanvas.width > 0;
    }

    gazer.pause = function() {
        paused = true;
        return gazer;
    }

    gazer.resume = function() {
        paused = false;
        loop();
        return gazer;
    }

    gazer.end = function() {
        //loop may run an extra time and fail due to removed elements
        paused = true;
        //remove video element and canvas
        document.body.removeChild(videoElement);
        document.body.removeChild(videoElementCanvas);

        setGlobalData();
        return gazer;
    }

    //PUBLIC FUNCTIONS - DEBUG

    gazer.detectCompatibility = function() {
        //TODO detectCompatibility
        return true;
    }

    gazer.performCalibration = function(desiredAccuracy) {
        //TODO performCalibration
    }

    gazer.showPredictionPoints = function(bool) {
        showGazeDot = bool;
        gazeDot.style.left = '-999em';
        return gazer;
    }

    //SETTERS
    gazer.setTracker = function(name) {
        //TODO validate name
        tracker = trackerMap[name]();    
        return gazer;
    }

    gazer.setRegression = function(name) {
        //TODO validate name
        var data = reg.getData();
        reg = regressionMap[name]();
        reg.setData(data);
        return gazer;
    }

    gazer.setGazeListener = function(listener) {
        //TODO validate listener
        callback = listener;
        return gazer;
    }

    gazer.clearGazeListener = function() {
        callback = nopCallback;
        return gazer;
    }

    //GETTERS
    gazer.getTracker = function() {
        //TODO decide if this should return the tracker object or just the string, tracker.name
        return tracker;
    }

    gazer.getRegression = function() {
        //TODO decide if this should return the regression object or just the string, reg.name
        return reg;
    }

    gazer.getCurrentPrediction = function() {
        return getPrediction(); 
    }
}(window));