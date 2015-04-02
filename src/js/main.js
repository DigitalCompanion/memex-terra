// Globals
var myApp = {};

$(function () {
  'use strict';

  myApp.map = null,
  myApp.locationBin = null,
  myApp.scale = null,
  myApp.pointFeature,
  myApp.ready = false,
  myApp.startTime = null;
  myApp.animationState = 0;
  myApp.timeRange = 0;
  myApp.location = null;
  myApp.visibleDialogs = [];
  myApp.prevTimestamp = 0;

  $( window ).resize(function() {
    myApp.resize();
  });

  myApp.map = geo.map({
          node: '#map',
          center: {
            x: -98.0,
            y: 39.5
          },
          zoom: 2,
          autoResize: false
        });
  myApp.map.createLayer(
    'osm',
    {
      baseUrl: 'http://otile1.mqcdn.com/tiles/1.0.0/map/'
    }
  );

  myApp.resize = function() {
    var height = $(window).height(),
        width  = $(window).width();
    myApp.map.resize(0, 0, width, height);
  }
  myApp.resize();

  // Aggregate data
  //--------------------------------------------------------------------------
  function aggregateByLocation(data) {
    var dataGroupedByLocation, key, min = 0, max = 1, newdata = [];
    myApp.locationBin = {};

    if (data) {
      data.forEach(function(item) {
        key = item.field7 + '|' + item.field6;
        if (key in myApp.locationBin) {
          myApp.locationBin[key].binCount = 1 + myApp.locationBin[key].binCount;
          myApp.locationBin[key].urls.push(item.field5);
          if (myApp.locationBin[key].binCount > max) {
            max = myApp.locationBin[key].binCount
          }
        } else {
          item.binCount = 1;
          item.urls = [item.field5];
          myApp.locationBin[key] = item;
          newdata.push(item);
        }
      });
    }

    return {"data": newdata, "min": min, "max": max};
  }

  // Query given a time duration
  //--------------------------------------------------------------------------
  function queryData(timeRange, location, callback) {
    var url = "/api/v1/data?limit=100000&duration=["+timeRange+"]";

    if (location !== undefined || location !== null) {
      url += "&location="+location+"";
    }

    console.log(url);

    $.ajax(url)
      .done(function(data) {

        if (callback !== undefined) {
          callback(data);
        }
      })
      .fail(function(err) {
        console.log(err);
      })
  }

  // Clear out any information that is related to a particular time duration
  //--------------------------------------------------------------------------
  function clearDialogs(callback) {
    var i = null;
    for (i = 0; i < myApp.visibleDialogs.length; ++i) {
      myApp.visibleDialogs[i].dialog.remove();
      myApp.visibleDialogs[i].dialog = null;
    }
    myApp.visibleDialogs = [];

    // Clear images
    $("#images").empty();
  }

  // Scrap a URL for images and return list of images URL
  //--------------------------------------------------------------------------
  function scrapUrl(url, callback) {
    $.ajax("/api/v1/scrape?url="+url+"")
      .done(function(data) {
        if (callback !== undefined) {
          callback(data);
        }
      })
      .fail(function(err) {
        console.log(err);
      })
  }

  // Create visualization given a dataset
  //--------------------------------------------------------------------------
  function render(data, callback) {
    var aggdata = aggregateByLocation(data);
    myApp.scale = d3.scale.linear().domain([aggdata.min, aggdata.max])
              .range([2, 50]);
    if (myApp.pointFeature === undefined) {
      myApp.pointFeature = myApp.map
                       .createLayer('feature')
                       .createFeature('point', {selectionAPI: true});

      myApp.pointFeature.layer().geoOn(geo.event.pan, function(evt) {
        var i = null, left = null, top = null;
        for (i = 0; i < myApp.visibleDialogs.length; ++i) {
          left = parseInt(myApp.visibleDialogs[i].dialog.css('left'), 10);
          top = parseInt(myApp.visibleDialogs[i].dialog.css('top'), 10);
          myApp.visibleDialogs[i].dialog.css({
            'left': left + evt.screenDelta.x,
            'top': top + evt.screenDelta.y,
          });
        }
      });

      myApp.pointFeature.layer().geoOn(geo.event.zoom, function(evt) {
        clearDialogs();
      });
    }
    if (myApp.pointFeature) {
      myApp.pointFeature.geoOff(geo.event.feature.mouseclick);
    }

    myApp.pointFeature
      .data(aggdata.data)
      .position(function (d) { return { x:d.field7, y:d.field6 } })
      .style('radius', function (d) { return myApp.scale(d.binCount); })
      .style('stroke', false)
      .style('fillOpacity', 0.4)
      .style('fillColor', 'orange')
      .geoOn(geo.event.feature.mouseclick, function (evt) {
        var div = evt.data.dialog || $(document.createElement('div')) ,
                  i = 0, anchor = null, list, listItem;
        div.empty();
        list = $(document.createElement('ul'));
        list.addClass('list-group');
        div.css({
          'top': evt.mouse.page.y,
          'left': evt.mouse.page.x,
        });
        for (i = 0; i < evt.data.urls.length; ++i) {
          anchor = $(document.createElement('a'));
          listItem = $(document.createElement('li'));
          listItem.addClass('list-group-item');
          anchor.text(evt.data.urls[i]);
          anchor.attr('href', evt.data.urls[i]);
          listItem.append(anchor);
          list.append(listItem);

          // Scrap the URL
          scrapUrl(evt.data.urls[i], function(images) {
            myApp.displayImages({
              "data": evt.data,
              "images": images});
          });
        }

        if (evt.data.dialog === null ||
            evt.data.dialog === undefined) {
          div.addClass('dialog-box');
          div.css({
            'position':'absolute',
            'padding':'5px',
            'box-shadow': '0px 0px 10px rgba(0, 0, 0, 0.5)'
          });
          $('body').append(div);
          evt.data.dialog = div;
          myApp.visibleDialogs.push(evt.data);
        }

        div.append(list);
      });

    myApp.map.draw();

    if (callback) {
      callback();
    }
  }

  // Update extents and then render
  //--------------------------------------------------------------------------
  myApp.updateExtents = function() {
    // Now run the query
    myApp.timeRange = $("#slider").slider("values");
    myApp.location = $("#search-location").text();
    queryData(myApp.timeRange, myApp.location, function(data) {
      // Clear out any previous information
      clearDialogs();

      render(data, function() {
        // Update the UI
        myApp.updateView(null, myApp.timeRange);
      });
    });
  }

  // Update view
  //--------------------------------------------------------------------------
  myApp.updateView = function(timestamp, timeRange)  {
    $ ("#start").html((new Date(timeRange[0] * 1000)).toDateString());
    $ ("#end").html((new Date(timeRange[1] * 1000)).toDateString());
  }

  // Animate data
  //--------------------------------------------------------------------------
  myApp.animate = function(timestamp) {
    if (myApp.ready) {
      // First get the values from the slider
      var range = $( "#slider" ).slider( "values" ),
          min = $( "#slider" ).slider( "option", "min" ),
          max = $( "#slider" ).slider( "option", "max" ),
          delta = myApp.timeRange[1] - myApp.timeRange[0],
          newRange = null,
          elapsedTime = timestamp - myApp.prevTimestamp;

      if (elapsedTime * 0.001 > 1) {
        myApp.prevTimestamp = timestamp;

        console.log('elapsedTime * 0.001 ', elapsedTime * 0.001);

        if (myApp.animationState == 3 || myApp.animationState == 1) {
          newRange = [ range[ 0 ] + delta, range[ 1 ] + delta ];
        } else if (myApp.animationState == 2) {
          newRange = [ range[ 0 ] - delta, range[ 1 ] - delta ];
        }

        if (range[1] === max) {
          newRange[0] = min;
          newRange[1] = newRange[0] + delta;
          console.log('newRange[1]', newRange[1]);
        }
        if (newRange[0] >= max) {
          newRange[0] = min;
        }
        if (newRange[0] <= min) {
          newRange[0] = min;
        }
        if (newRange[1] > max) {
          newRange[1] = max;
        }
        if (newRange[1] <= min) {
          newRange[1] = newRange[0] + delta;
        }

        // Set the slider value
        $( "#slider" ).slider( "option", "values", newRange );

        myApp.timeRange = newRange;
        myApp.location = $("#search-location").text();

        // Query the data and create vis again
        queryData(myApp.timeRange, myApp.location, function(data) {
          render(data, function() {
            myApp.updateView(null, newRange);

            if (myApp.animationState === 1) {
              window.requestAnimationFrame(myApp.animate);
            }
          });
        });

      } else {
        window.requestAnimationFrame(myApp.animate);
      }
    }
  }

  $.ajax( "/api/v1/data" )
    .done(function(range) {
      var format = d3.time.format("%Y-%m-%d %H:%M:%S");
      console.log(format.parse(range.duration.start.field4));
      console.log(format.parse(range.duration.end.field4));

      var min = format.parse(range.duration.start.field4);
      var max = format.parse(range.duration.end.field4);

      // Set the date range
      $( "#slider" ).slider({
        range: true,
        min: min.getTime()/1000,
        max: max.getTime()/1000,
        values: [ min.getTime()/1000, min.getTime()/1000 + 24 * 3600 * 180 ],
        stop: function( event, ui ) {
          myApp.updateExtents();
        }
      });

      myApp.updateExtents();
      myApp.ready = true;
    })
    .fail(function() {
      console.log('failed');
    });

  $( "#slider" ).slider();
});


// Event handlers
//--------------------------------------------------------------------------
myApp.buttonBackPress = function() {
  myApp.animationState = 2;
  window.requestAnimationFrame(myApp.animate);
}

myApp.buttonPlayPress = function() {
  myApp.animationState = 1;
  window.requestAnimationFrame(myApp.animate);
}

myApp.buttonStopPress = function() {
  myApp.animationState = 0;
  var min = $( "#slider" ).slider( "option", "min" ),
      max = $( "#slider" ).slider( "option", "max" ),
      range = $( "#slider" ).slider( "option", "values" );

  $( "#slider" ).slider( "option", "values",
    [ min, min + (range[1] - range[0]) ] );

  myApp.updateExtents();
}

myApp.buttonForwardPress = function() {
  myApp.animationState = 3;
  window.requestAnimationFrame(myApp.animate);
}


// Display images
//--------------------------------------------------------------------------
myApp.displayImages = function(data) {
  var div = $("#images"),
      newDiv = $(document.createElement('div')),
      tag = $(document.createElement('div')),
      i = null;
  div.append(newDiv);
  newDiv.addClass('row');
  tag.addClass('col-md-12');
  newDiv.append(tag);
  if (data.images.length > 0) {
    tag.append("<h3 class='hd-highlight'>"+data.data["field3"]+"</h3>");
    for (i = 0; i < data.images.length; ++i) {
      var imageDiv = $(document.createElement('div'));
      imageDiv.addClass('col-xs-1');
      newDiv.append(imageDiv)
      var newAnchor = $(document.createElement('a'));
      var newImage = $(document.createElement('img'));
      newImage.addClass('img-responsive img-fluid img-blur');
      newImage.on('mouseover', function() {
        $(this).addClass('img-clear');
        $(this).removeClass('img-blur');
      });
      newImage.on('mouseout', function() {
        $(this).addClass('img-blur');
        $(this).removeClass('img-clear');
      });
      imageDiv.append(newAnchor);
      newAnchor.append(newImage);
      newImage.attr('src', data.images[i]);
    }
  }
}