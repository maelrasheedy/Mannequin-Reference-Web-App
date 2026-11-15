from flask import Flask, jsonify

# Here i am creating the Flask application that will serve as the backend for the Mannequin Reference Web App. The Flask framework is used to handle HTTP requests and responses.
app = Flask(__name__)

# This route checks if the backend is running
@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "message": "Mannequin Reference Web App backend is running!"
    })

# Start the server
if __name__ == "__main__":
    app.run(debug=True, port=5000)