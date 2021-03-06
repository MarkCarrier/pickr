const _ = require("lodash");
const got = require('got');
const Flickr = require("flickrapi");
const exifparser = require('exif-parser');
const PubSub = require('pubsub-js');

module.exports = function(config, logger) {

  const flickrOptions = {
    api_key: config.get('api_key'),
    secret: config.get('secret'),
    user_id: config.get('user_id'),
    access_token: config.get('access_token'),
    access_token_secret: config.get('access_token_secret')
  };

  var handlePhotoRequest = async function(msg, data) {
    logger.info('Photo loader has received a request.');
    try {
      let newPhoto = await getAGoodPhoto();
      PubSub.publish( 'photosArrivals', newPhoto)  
    } catch(err) {    
        setTimeout(() => { PubSub.publish( 'photosRequests', {  } ) },5000);
        logger.error('Photo retrieval failure (retrying in 5s) =>', err);
        //logger.info('Exiting because I didn\'t recognize this error: ' + JSON.stringify(err));
        //process.exit(1);
    }
  }

  var getAGoodPhoto = async function() {  
    return new Promise(async function(resolve, reject) {
      try  {
        let flickrConnection = await getFlickrConnection();
        let userids = config.get('users');

        let userId = userids[_.random(0, userids.length - 1, false)];
        
        let totatNumberOfPhotos = await getTotalNumberOfPhotos(flickrConnection, userId);
        let aGoodPictureData = undefined;
        let aGoodPictureBits = undefined;
        let aGoodPictureExif = undefined;
        while (aGoodPictureData == undefined) {
          let aRandomPictureData = await getARandomPictureData(flickrConnection, userId, totatNumberOfPhotos)
          let aRandomPictureSizes = await getPictureAvailableSizes(flickrConnection, aRandomPictureData, userId)
          var aRandomPictureOriginalSize = _.find(aRandomPictureSizes.sizes.size, { label: "Original"});
          if (await pictureDataIsGood(aRandomPictureData, aRandomPictureOriginalSize)) {
            aGoodPictureData = aRandomPictureData;
            aGoodPictureBits = await getPictureBits(aRandomPictureOriginalSize.source);          
            aGoodPictureExif = await getPictureExif(aGoodPictureBits);
          }
          else {
            logger.info('Picture ' + aRandomPictureData.photos.photo[0].title + ' is not good.  Trying another.')
          }
        }

        logger.info('Good picture ready');    

        resolve(
          { 
            photoInfo: aGoodPictureData, 
            photoExif: aGoodPictureExif,
            photoData: Buffer.from(aGoodPictureBits).toString('base64')
          });
      } catch (err) {
        logger.error('Failed to getAGoodPhoto',err);
        reject(err);
      }
    });
  }

  var getFlickrConnection = async function() {
    return new Promise(async function(resolve, reject) {
      Flickr.authenticate(flickrOptions, function(error, flickr) {
        if(error) {
        logger.error('Failed to getFlickrConnection',error);
          reject(error);
        } else {
          resolve(flickr);
        }
      });
    });
  }

  var getTotalNumberOfPhotos = async function(flickrConnection, userId) {
    return new Promise(async function(resolve, reject) {  
      try {  
        flickrConnection.people.getPhotos({ user_id: userId, authenticated: true, privacy_filter: 4, per_page: 1}, function(err, result) {
          if(err)
            reject(err);
          else
            resolve(result.photos.total);
        });
      } catch(err) {
        logger.error('Failed to flickr getTotalNumberOfPhotos', err);
        reject(err);
      }
    });
  }

  var getARandomPictureData = async function(flickrConnection, userId, totatNumberOfPhotos) {
    return new Promise(async function(resolve, reject) {
      var randomPhotoNumber = Math.floor(Math.random() * totatNumberOfPhotos);    
      try { 
        //if(flickr.options && flickr.options.users && flickr.options.users.length)
        //  user = flickr.options.users[0];
          
        flickrConnection.photos.search({
          user_id: userId,
          authenticated: true,
          per_page: 1,
          page: randomPhotoNumber
        }, function(err, searchResult) { 
          resolve(searchResult); 
        });
      } catch (err)  {
        logger.error('Failed to flickr search', err);
        reject(err)
      }
    })
  }

  var getPictureAvailableSizes = async function(flickrConnection, flickrPhotoSearchResult, userId) {
    return new Promise(async function(resolve, reject) {
      try {
        flickrConnection.photos.getSizes({
          user_id: userId,
          authenticated: true,
          photo_id: flickrPhotoSearchResult.photos.photo[0].id
        }, function(err, availableSizes) { 
            if(err)
              reject(err);
            else
              resolve(availableSizes);
        });
      } catch (err)  {
        logger.error('Failed to flickr getPictureAvailableSizes', err);
        reject(err)
      }
    });
  }

  pictureDataIsGood = async function(flickrPhotoSearchResult, originalPhotoData) {
    return new Promise(async function(resolve, reject) {
      try {
        let photoIsGood = flickrPhotoSearchResult.photos.photo[0].ispublic || flickrPhotoSearchResult.photos.photo[0].isfamily || flickrPhotoSearchResult.photos.photo[0].isfriend;
        photoIsGood = photoIsGood && originalPhotoData.media == "photo";
        if(photoIsGood) {
          resolve(true)
        } else {
          resolve(false);
        }
      } catch (err)  {
        logger.error('Failed to check pictureDataIsGood', err);
        reject(err)
      }
    })
  }

  var getPictureBits = async function(url) {
    return new Promise(async function(resolve, reject) {
      try {
        logger.info('Fetching ' + url);
        var response = await got(url, { encoding: null });
        logger.info('Got response ' + response.body.length);
        resolve(response.body);
      } catch (error) {
          logger.error('getPictureBits error: ' + error.message);
          reject(error);
      }
    });
  }

  var getPictureExif = function(pictureData) {
    return new Promise(async function(resolve, reject) {
      try {
        logger.info('Extracting EXIF');
        var parser = exifparser.create(pictureData);
        var result = parser.parse();
        resolve(result);
      } catch (error) {
          logger.error('getPictureExif error: ' + error.message);
          reject(error);
      }
    });
  }

  return {
    handlePhotoRequest
  }

}