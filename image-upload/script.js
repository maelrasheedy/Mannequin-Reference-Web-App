
/* Here I am connecting my JavaScript to the elements I created in HTML */

const sketchUpload = document.getElementById("sketchUpload");

const imagePreview = document.getElementById("imagePreview");

const removeImage = document.getElementById("removeImage");

const uploadMessage = document.getElementById("uploadMessage");


// Here I am connecting JavaScript to the heading and instructions
const uploadInstructions = document.getElementById("uploadInstructions");



// Here I am hiding the preview and remove button when the page first opens
imagePreview.hidden = true;
removeImage.hidden = true;


/* Here I am checking when the user selects an image from their computer */

sketchUpload.addEventListener("change", function () {

    // Here I am getting the file the user selected
    const file = sketchUpload.files[0];

    // Here I am clearing the previous image before checking a new one
    if (imagePreview.src.startsWith("blob:")) {
        URL.revokeObjectURL(imagePreview.src);
    }

    imagePreview.removeAttribute("src");
    imagePreview.hidden = true;
    removeImage.hidden = true;
    uploadMessage.textContent = "";
    
    uploadInstructions.hidden = false;
    document.querySelector("main").classList.remove("has-image");

    // Here I am checking if the user actually selected a file
    if (!file) {
        return;
    }

    // Here I am checking if the selected file is a JPG, JPEG, or PNG image
    const allowedTypes = ["image/jpeg", "image/png"];

    if (!allowedTypes.includes(file.type)) {
        uploadMessage.textContent = "Please select a JPG, JPEG, or PNG image.";
        sketchUpload.value = "";
        return;
    }

    // Here I am setting the largest image size the user can upload
    const maxFileSize = 10 * 1024 * 1024;

    // Here I am checking if the selected image is larger than 10 MB
    if (file.size > maxFileSize) {
        uploadMessage.textContent = "Image must be 10 MB or smaller.";
        sketchUpload.value = "";
        return;
    }

    // Here I am creating a temporary URL so I can preview the image
    const imageURL = URL.createObjectURL(file);

    // Here I am displaying the selected image on the webpage
    imagePreview.src = imageURL;
    imagePreview.hidden = false;


    // Here I am hiding the instructions when an image is uploaded
    uploadInstructions.hidden = true;
    document.querySelector("main").classList.add("has-image");


    // Here I am showing the button that lets the user remove the image
    removeImage.hidden = false;

    // Here I am letting the user know the image was selected successfully
    uploadMessage.textContent = "Image selected successfully!";

});


/* Here I am letting the user remove an image they uploaded */

removeImage.addEventListener("click", function () {

    // Here I am clearing the selected file
    sketchUpload.value = "";

    // Here I am releasing the temporary image URL
    if (imagePreview.src.startsWith("blob:")) {
        URL.revokeObjectURL(imagePreview.src);
    }

    // Here I am removing the image from the preview
    imagePreview.removeAttribute("src");

    // Here I am hiding the preview and remove button
    imagePreview.hidden = true;
    removeImage.hidden = true;


    // Here I am bringing back the upload instructions when the image is removed
    uploadInstructions.hidden = false;
    document.querySelector("main").classList.remove("has-image");


    // Here I am letting the user know the image was removed
    uploadMessage.textContent = "Image removed successfully!";

});
